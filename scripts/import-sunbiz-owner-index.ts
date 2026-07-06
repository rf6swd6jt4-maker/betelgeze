import { createReadStream, existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"

import { createClient } from "@supabase/supabase-js"

import type { SunbizOwnerIndexRow } from "../lib/leadgen/sunbiz-bulk-index"

type SunbizImportSourceKey = SunbizOwnerIndexRow["source_key"]
type SunbizImportMode = "append" | "replace"
type SunbizLineParser = (line: string) => SunbizOwnerIndexRow[]

type CliOptions = {
    sourceKey: SunbizImportSourceKey | null
    mode: SunbizImportMode
    dryRun: boolean
    batchSize: number
    files: string[]
}
type ResolvedCliOptions = Omit<CliOptions, "sourceKey"> & {
    sourceKey: SunbizImportSourceKey
}

const SUNBIZ_IMPORT_SOURCES = new Set<SunbizImportSourceKey>([
    "registry.fl.sunbiz",
    "registry.fl.fictitious_names",
])

function loadEnvFile(filePath: string) {
    if (!existsSync(filePath)) return
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
        if (!match) continue
        const [, key, rawValue] = match
        if (process.env[key]) continue
        process.env[key] = rawValue.replace(/^['"]|['"]$/g, "")
    }
}

function requiredEnv(name: string) {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required environment variable: ${name}`)
    return value
}

function normaliseSunbizImportSourceKey(value: string | null | undefined): SunbizImportSourceKey | null {
    const sourceKey = String(value ?? "").trim()
    return SUNBIZ_IMPORT_SOURCES.has(sourceKey as SunbizImportSourceKey) ? sourceKey as SunbizImportSourceKey : null
}

function normaliseSunbizImportMode(value: string | null | undefined): SunbizImportMode {
    return String(value ?? "").trim().toLowerCase() === "replace" ? "replace" : "append"
}

function dbRow(row: SunbizOwnerIndexRow) {
    return {
        source_key: row.source_key,
        record_id: row.record_id,
        business_name: row.business_name,
        status: row.status,
        record_type: row.record_type,
        person_name: row.person_name,
        person_role: row.person_role,
        person_source_field: row.person_source_field,
        person_type: row.person_type,
        address: row.address,
        search_text: row.search_text,
        raw_payload: row.raw_payload,
        imported_at: new Date().toISOString(),
    }
}

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {
        sourceKey: null,
        mode: "append",
        dryRun: false,
        batchSize: 500,
        files: [],
    }
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]
        if (arg === "--source" || arg === "--sourceKey") {
            options.sourceKey = normaliseSunbizImportSourceKey(argv[index + 1])
            index += 1
        } else if (arg === "--mode") {
            options.mode = normaliseSunbizImportMode(argv[index + 1])
            index += 1
        } else if (arg === "--replace") {
            options.mode = "replace"
        } else if (arg === "--append") {
            options.mode = "append"
        } else if (arg === "--dry-run") {
            options.dryRun = true
        } else if (arg === "--batch-size") {
            options.batchSize = Math.min(1000, Math.max(50, Number(argv[index + 1]) || 500))
            index += 1
        } else {
            options.files.push(arg)
        }
    }
    return options
}

function usage() {
    return [
        "Usage:",
        "  npm run import:sunbiz -- --source registry.fl.fictitious_names --mode replace /Users/jedryszczyk/Downloads/FICFILE.txt",
        "  npm run import:sunbiz -- --source registry.fl.sunbiz --mode replace /Users/jedryszczyk/Downloads/cordata*.txt",
        "",
        "Options:",
        "  --dry-run              Parse files without writing to Supabase.",
        "  --batch-size 500       Supabase upsert batch size, 50-1000.",
    ].join("\n")
}

async function loadSunbizParsers() {
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "lib/leadgen/sunbiz-bulk-index.ts")).href
    const parserModule = await import(moduleUrl) as {
        parseSunbizCorporateOwnerRows: SunbizLineParser
        parseSunbizFictitiousNameOwnerRows: SunbizLineParser
    }
    return parserModule
}

function parserFor(
    sourceKey: SunbizImportSourceKey,
    parsers: Awaited<ReturnType<typeof loadSunbizParsers>>
) {
    return sourceKey === "registry.fl.sunbiz"
        ? parsers.parseSunbizCorporateOwnerRows
        : parsers.parseSunbizFictitiousNameOwnerRows
}

function progressLine(input: {
    file: string
    lineCount: number
    parsedRows: number
    importedRows: number
    batches: number
}) {
    return [
        `file=${path.basename(input.file)}`,
        `lines=${input.lineCount.toLocaleString()}`,
        `parsed=${input.parsedRows.toLocaleString()}`,
        `imported=${input.importedRows.toLocaleString()}`,
        `batches=${input.batches.toLocaleString()}`,
    ].join(" ")
}

async function importFiles(options: ResolvedCliOptions) {
    const parsers = await loadSunbizParsers()
    const supabase = createClient(
        requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
        requiredEnv("SUPABASE_SERVICE_ROLE_KEY")
    )
    const parseLine = parserFor(options.sourceKey, parsers)
    const batchSize = options.batchSize
    let parsedRows = 0
    let importedRows = 0
    let batches = 0
    if (options.mode === "replace" && !options.dryRun) {
        console.log(`Clearing existing ${options.sourceKey} rows...`)
        const { error } = await supabase
            .from("leadgen_sunbiz_owner_index")
            .delete()
            .eq("source_key", options.sourceKey)
        if (error) throw new Error(`Could not clear existing Sunbiz index rows: ${error.message}`)
    }

    for (const file of options.files) {
        if (!existsSync(file)) throw new Error(`File does not exist: ${file}`)
        let lineCount = 0
        let fileParsedRows = 0
        let fileImportedRows = 0
        let batch: SunbizOwnerIndexRow[] = []
        const reader = createInterface({
            input: createReadStream(file, { encoding: "utf8" }),
            crlfDelay: Infinity,
        })
        for await (const line of reader) {
            lineCount += 1
            const rows = line.trim() ? parseLine(line) : []
            if (rows.length === 0) continue
            parsedRows += rows.length
            fileParsedRows += rows.length
            batch.push(...rows)
            if (batch.length >= batchSize) {
                const currentBatch = batch
                batch = []
                batches += 1
                if (!options.dryRun) {
                    const { error } = await supabase
                        .from("leadgen_sunbiz_owner_index")
                        .upsert(currentBatch.map(dbRow), { onConflict: "source_key,record_id,person_source_field,person_name" })
                    if (error) throw new Error(`Could not import Sunbiz index batch ${batches}: ${error.message}`)
                    importedRows += currentBatch.length
                    fileImportedRows += currentBatch.length
                }
            }
        }
        if (batch.length > 0) {
            batches += 1
            if (!options.dryRun) {
                const { error } = await supabase
                    .from("leadgen_sunbiz_owner_index")
                    .upsert(batch.map(dbRow), { onConflict: "source_key,record_id,person_source_field,person_name" })
                if (error) throw new Error(`Could not import Sunbiz index batch ${batches}: ${error.message}`)
                importedRows += batch.length
                fileImportedRows += batch.length
            }
        }
        console.log(progressLine({
            file,
            lineCount,
            parsedRows: fileParsedRows,
            importedRows: fileImportedRows,
            batches,
        }))
    }

    if (parsedRows === 0) throw new Error("No importable Sunbiz owner/officer rows were parsed from the provided files.")
    if (!options.dryRun) {
        await supabase
            .from("leadgen_source_health")
            .upsert({
                source_key: options.sourceKey,
                status: "healthy",
                last_error: null,
                last_success_at: new Date().toISOString(),
                metadata: {
                    import_mode: options.mode,
                    imported_rows: importedRows,
                    parsed_rows: parsedRows,
                    importer: "local_sunbiz_owner_index_import",
                },
            }, { onConflict: "source_key" })
    }
    return { parsedRows, importedRows, batches }
}

async function main() {
    loadEnvFile(path.join(process.cwd(), ".env.local"))
    loadEnvFile(path.join(process.cwd(), ".env"))
    const options = parseArgs(process.argv.slice(2))
    if (!options.sourceKey || options.files.length === 0) {
        console.error(usage())
        process.exitCode = 1
        return
    }
    const result = await importFiles({ ...options, sourceKey: options.sourceKey })
    console.log(JSON.stringify({
        status: "ok",
        sourceKey: options.sourceKey,
        mode: options.mode,
        dryRun: options.dryRun,
        ...result,
    }, null, 2))
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
})
