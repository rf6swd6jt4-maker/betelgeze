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
    skipClear: boolean
    probe: boolean
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

function validateSupabaseUrl(value: string) {
    let url: URL
    try {
        url = new URL(value)
    } catch {
        throw new Error(`NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${value}`)
    }
    if (url.hostname === "your-project.supabase.co") {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL is still set to the placeholder https://your-project.supabase.co. Pull or paste the real Supabase project URL into .env.local before running the import.")
    }
    if (!url.hostname.endsWith(".supabase.co")) {
        console.warn(`NEXT_PUBLIC_SUPABASE_URL host is ${url.hostname}; expected a *.supabase.co project URL.`)
    }
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
        skipClear: false,
        probe: false,
        batchSize: 50,
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
        } else if (arg === "--skip-clear") {
            options.skipClear = true
        } else if (arg === "--probe") {
            options.probe = true
        } else if (arg === "--batch-size") {
            options.batchSize = Math.min(1000, Math.max(1, Number(argv[index + 1]) || 50))
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
        "  npm run import:sunbiz -- --source registry.fl.sunbiz --mode replace --skip-clear /Users/jedryszczyk/Downloads/cordata*.txt",
        "",
        "Options:",
        "  --dry-run              Parse files without writing to Supabase.",
        "  --skip-clear           Do not delete existing rows before a replace import; useful for retrying/resuming.",
        "  --probe                Check Supabase REST connectivity before reading files.",
        "  --batch-size 50        Supabase upsert batch size, 1-1000.",
    ].join("\n")
}

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeSupabaseError(error: unknown): string {
    if (!error) return "Unknown Supabase error"
    if (error instanceof AggregateError) {
        return error.errors.map((item) => describeSupabaseError(item)).join("; ")
    }
    if (error instanceof Error) {
        const cause = "cause" in error ? error.cause : null
        return cause ? `${error.message}; cause=${describeSupabaseError(cause)}` : error.message
    }
    if (typeof error === "object" && error !== null && "message" in error) {
        const typedError = error as { message?: unknown; code?: unknown; errno?: unknown; syscall?: unknown; hostname?: unknown; cause?: unknown }
        const details = [
            typedError.message ? `message=${String(typedError.message)}` : null,
            typedError.code ? `code=${String(typedError.code)}` : null,
            typedError.errno ? `errno=${String(typedError.errno)}` : null,
            typedError.syscall ? `syscall=${String(typedError.syscall)}` : null,
            typedError.hostname ? `hostname=${String(typedError.hostname)}` : null,
            typedError.cause ? `cause=${describeSupabaseError(typedError.cause)}` : null,
        ].filter(Boolean)
        return details.length > 0 ? details.join(" ") : JSON.stringify(error)
    }
    return String(error)
}

function isLikelyTransportError(error: unknown) {
    const message = describeSupabaseError(error).toLowerCase()
    return message.includes("fetch failed")
        || message.includes("econnreset")
        || message.includes("etimedout")
        || message.includes("timeout")
        || message.includes("socket")
        || message.includes("network")
}

async function withSupabaseRetry<T>(
    label: string,
    operation: () => PromiseLike<{ data?: T | null; error?: unknown }>
) {
    const maxAttempts = 4
    let lastError: unknown = null
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let data: T | null | undefined
        let error: unknown
        try {
            const result = await operation()
            data = result.data
            error = result.error
        } catch (caughtError) {
            error = caughtError
        }
        if (!error) return data ?? null
        lastError = error
        const message = describeSupabaseError(error)
        if (attempt < maxAttempts) {
            const delayMs = 750 * attempt
            console.warn(`${label} failed on attempt ${attempt}/${maxAttempts}: ${message}. Retrying in ${delayMs}ms...`)
            await wait(delayMs)
        }
    }
    throw new Error(`${label} failed after ${maxAttempts} attempts: ${describeSupabaseError(lastError)}`)
}

async function withAdaptiveSupabaseUpsert(
    label: string,
    rows: SunbizOwnerIndexRow[],
    upsertRows: (rows: SunbizOwnerIndexRow[]) => PromiseLike<{ data?: unknown | null; error?: unknown }>
): Promise<number> {
    try {
        await withSupabaseRetry(label, () => upsertRows(rows))
        return rows.length
    } catch (error) {
        if (rows.length <= 1 || !isLikelyTransportError(error)) throw error
        const midpoint = Math.ceil(rows.length / 2)
        console.warn(`${label} failed for ${rows.length} rows; retrying as ${midpoint} + ${rows.length - midpoint} rows.`)
        const firstImported = await withAdaptiveSupabaseUpsert(`${label}a`, rows.slice(0, midpoint), upsertRows)
        const secondImported = await withAdaptiveSupabaseUpsert(`${label}b`, rows.slice(midpoint), upsertRows)
        return firstImported + secondImported
    }
}

async function probeSupabaseRest(url: string, serviceRoleKey: string) {
    const endpoint = `${url.replace(/\/$/, "")}/rest/v1/leadgen_sunbiz_owner_index?select=id&limit=1`
    let response: Response
    try {
        response = await fetch(endpoint, {
            headers: {
                apikey: serviceRoleKey,
                authorization: `Bearer ${serviceRoleKey}`,
            },
        })
    } catch (error) {
        throw new Error(`Supabase REST probe could not reach ${new URL(url).hostname}: ${describeSupabaseError(error)}`)
    }
    if (!response.ok) {
        const body = await response.text().catch(() => "")
        throw new Error(`Supabase REST probe failed: ${response.status} ${response.statusText} ${body.slice(0, 240)}`)
    }
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
    const needsSupabase = !options.dryRun || options.probe
    const supabaseUrl = needsSupabase ? requiredEnv("NEXT_PUBLIC_SUPABASE_URL") : null
    const serviceRoleKey = needsSupabase ? requiredEnv("SUPABASE_SERVICE_ROLE_KEY") : null
    if (supabaseUrl) validateSupabaseUrl(supabaseUrl)
    const supabase = supabaseUrl && serviceRoleKey
        ? createClient(supabaseUrl, serviceRoleKey)
        : null
    if (options.probe && supabaseUrl && serviceRoleKey) {
        console.log("Probing Supabase REST connectivity...")
        await probeSupabaseRest(supabaseUrl, serviceRoleKey)
        console.log("Supabase REST probe succeeded.")
    }
    const parseLine = parserFor(options.sourceKey, parsers)
    const batchSize = options.batchSize
    let parsedRows = 0
    let importedRows = 0
    let batches = 0
    if (options.mode === "replace" && options.skipClear) {
        console.log(`Skipping clear for ${options.sourceKey}; existing matching rows will be overwritten by upsert.`)
    } else if (options.mode === "replace" && !options.dryRun && supabase) {
        console.log(`Clearing existing ${options.sourceKey} rows...`)
        await withSupabaseRetry("Clearing existing Sunbiz index rows", () => supabase
            .from("leadgen_sunbiz_owner_index")
            .delete()
            .eq("source_key", options.sourceKey))
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
                if (!options.dryRun && supabase) {
                    await withAdaptiveSupabaseUpsert(`Importing Sunbiz index batch ${batches}`, currentBatch, (rowsToImport) => supabase
                        .from("leadgen_sunbiz_owner_index")
                        .upsert(rowsToImport.map(dbRow), { onConflict: "source_key,record_id,person_source_field,person_name" }))
                    importedRows += currentBatch.length
                    fileImportedRows += currentBatch.length
                }
            }
        }
        if (batch.length > 0) {
            batches += 1
            if (!options.dryRun && supabase) {
                await withAdaptiveSupabaseUpsert(`Importing Sunbiz index batch ${batches}`, batch, (rowsToImport) => supabase
                    .from("leadgen_sunbiz_owner_index")
                    .upsert(rowsToImport.map(dbRow), { onConflict: "source_key,record_id,person_source_field,person_name" }))
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
    if (!options.dryRun && supabase) {
        await withSupabaseRetry("Marking Sunbiz source health healthy", () => supabase
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
            }, { onConflict: "source_key" }))
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
