import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline"
import { pipeline } from "node:stream/promises"
import { pathToFileURL } from "node:url"
import { createGzip } from "node:zlib"

import type { SunbizOwnerIndexRow } from "../lib/leadgen/sunbiz-bulk-index"
import type { SunbizShardRecord } from "../lib/leadgen/sunbiz-shards"

type SunbizImportSourceKey = SunbizOwnerIndexRow["source_key"]
type SunbizLineParser = (line: string) => SunbizOwnerIndexRow[]
type SunbizShardHelpers = {
    SUNBIZ_DEFAULT_SHARD_PREFIX_LENGTH: number
    SUNBIZ_SHARD_VERSION: string
    sunbizShardKeyForName: (value: string | null | undefined, prefixLength?: number) => string
    sunbizShardKeysForName: (value: string | null | undefined, prefixLength?: number) => string[]
    sunbizShardRecordFromOwnerRow: (row: SunbizOwnerIndexRow) => SunbizShardRecord | null
    sunbizShardSourcePath: (sourceKey: SunbizImportSourceKey) => string
}

type CliOptions = {
    sourceKey: SunbizImportSourceKey | null
    outDir: string
    version: string
    prefixLength: number
    includeInactive: boolean
    keepJsonl: boolean
    progressLines: number
    files: string[]
}

const SUNBIZ_IMPORT_SOURCES = new Set<SunbizImportSourceKey>([
    "registry.fl.sunbiz",
    "registry.fl.fictitious_names",
])

function normaliseSunbizImportSourceKey(value: string | null | undefined): SunbizImportSourceKey | null {
    const sourceKey = String(value ?? "").trim()
    return SUNBIZ_IMPORT_SOURCES.has(sourceKey as SunbizImportSourceKey) ? sourceKey as SunbizImportSourceKey : null
}

function usage() {
    return [
        "Usage:",
        "  npm run build:sunbiz-shards -- --source registry.fl.sunbiz --out .sunbiz-shards /Users/jedryszczyk/Downloads/cordata*.txt",
        "  npm run build:sunbiz-shards -- --source registry.fl.fictitious_names --out .sunbiz-shards /Users/jedryszczyk/Downloads/FICFILE.txt",
        "",
        "Options:",
        "  --prefix-length 3      Business-name shard prefix length.",
        "  --include-inactive     Include inactive/cancelled/expired Sunbiz records.",
        "  --keep-jsonl           Keep uncompressed .jsonl files after .jsonl.gz files are written.",
        "  --progress-lines 50000 Print progress while processing large files.",
    ].join("\n")
}

async function loadSunbizParsers() {
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "lib/leadgen/sunbiz-bulk-index.ts")).href
    return await import(moduleUrl) as {
        parseSunbizCorporateOwnerRows: SunbizLineParser
        parseSunbizFictitiousNameOwnerRows: SunbizLineParser
    }
}

async function loadSunbizShardHelpers() {
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "lib/leadgen/sunbiz-shards.ts")).href
    return await import(moduleUrl) as SunbizShardHelpers
}

function parseArgs(argv: string[], helpers: Pick<SunbizShardHelpers, "SUNBIZ_DEFAULT_SHARD_PREFIX_LENGTH" | "SUNBIZ_SHARD_VERSION">): CliOptions {
    const options: CliOptions = {
        sourceKey: null,
        outDir: ".sunbiz-shards",
        version: helpers.SUNBIZ_SHARD_VERSION,
        prefixLength: helpers.SUNBIZ_DEFAULT_SHARD_PREFIX_LENGTH,
        includeInactive: false,
        keepJsonl: false,
        progressLines: 50_000,
        files: [],
    }
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]
        if (arg === "--source" || arg === "--sourceKey") {
            options.sourceKey = normaliseSunbizImportSourceKey(argv[index + 1])
            index += 1
        } else if (arg === "--out") {
            options.outDir = argv[index + 1] ?? options.outDir
            index += 1
        } else if (arg === "--version") {
            options.version = argv[index + 1] ?? options.version
            index += 1
        } else if (arg === "--prefix-length") {
            options.prefixLength = Math.min(5, Math.max(1, Number(argv[index + 1]) || options.prefixLength))
            index += 1
        } else if (arg === "--include-inactive") {
            options.includeInactive = true
        } else if (arg === "--keep-jsonl") {
            options.keepJsonl = true
        } else if (arg === "--progress-lines") {
            options.progressLines = Math.max(1_000, Number(argv[index + 1]) || options.progressLines)
            index += 1
        } else {
            options.files.push(arg)
        }
    }
    return options
}

function shouldImportRow(row: SunbizOwnerIndexRow, options: Pick<CliOptions, "includeInactive">) {
    return options.includeInactive || row.status === "Active"
}

class ShardWriter {
    private readonly streams = new Map<string, ReturnType<typeof createWriteStream>>()
    private readonly touchedFiles = new Set<string>()
    private readonly maxOpenStreams: number

    constructor(maxOpenStreams = 96) {
        this.maxOpenStreams = maxOpenStreams
    }

    write(filePath: string, line: string) {
        let stream = this.streams.get(filePath)
        if (!stream) {
            mkdirSync(path.dirname(filePath), { recursive: true })
            stream = createWriteStream(filePath, { flags: "a" })
            this.streams.set(filePath, stream)
            this.touchedFiles.add(filePath)
            if (this.streams.size > this.maxOpenStreams) this.closeOldestStream()
        }
        stream.write(line)
    }

    private closeOldestStream() {
        const next = this.streams.entries().next()
        if (next.done) return
        const [filePath, stream] = next.value
        stream.end()
        this.streams.delete(filePath)
    }

    async closeAll() {
        await Promise.all([...this.streams.values()].map((stream) => new Promise<void>((resolve, reject) => {
            stream.on("finish", resolve)
            stream.on("error", reject)
            stream.end()
        })))
        this.streams.clear()
    }

    files() {
        return [...this.touchedFiles].sort()
    }
}

function elapsed(startedAt: number) {
    return `${Math.max(1, Math.round((Date.now() - startedAt) / 1000)).toLocaleString()}s`
}

async function gzipFile(filePath: string, keepJsonl: boolean) {
    const gzPath = `${filePath}.gz`
    await pipeline(createReadStream(filePath), createGzip({ level: 9 }), createWriteStream(gzPath))
    if (!keepJsonl) unlinkSync(filePath)
}

function directorySizeBytes(dir: string): number {
    if (!existsSync(dir)) return 0
    return readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) return total + directorySizeBytes(fullPath)
        return total + statSync(fullPath).size
    }, 0)
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    const units = ["KB", "MB", "GB", "TB"]
    let value = bytes / 1024
    let unit = units.shift() ?? "KB"
    while (value >= 1024 && units.length) {
        value /= 1024
        unit = units.shift() ?? unit
    }
    return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`
}

async function buildShards(options: CliOptions, helpers: SunbizShardHelpers, parsers: Awaited<ReturnType<typeof loadSunbizParsers>>) {
    if (!options.sourceKey) throw new Error("Provide --source as registry.fl.sunbiz or registry.fl.fictitious_names.")
    if (options.files.length === 0) throw new Error("Provide one or more Sunbiz fixed-width .txt files.")
    const parseLine = options.sourceKey === "registry.fl.sunbiz"
        ? parsers.parseSunbizCorporateOwnerRows
        : parsers.parseSunbizFictitiousNameOwnerRows
    const sourcePath = helpers.sunbizShardSourcePath(options.sourceKey)
    const outputSourceDir = path.join(options.outDir, options.version, sourcePath)
    if (existsSync(outputSourceDir)) rmSync(outputSourceDir, { recursive: true, force: true })
    mkdirSync(outputSourceDir, { recursive: true })

    const writer = new ShardWriter()
    const startedAt = Date.now()
    let totalLines = 0
    let parsedRows = 0
    let writtenRows = 0
    let skippedRows = 0

    for (const [fileIndex, file] of options.files.entries()) {
        if (!existsSync(file)) throw new Error(`File does not exist: ${file}`)
        let lineCount = 0
        let fileParsedRows = 0
        let fileWrittenRows = 0
        let fileSkippedRows = 0
        let nextProgressLine = options.progressLines
        console.log(`Starting ${path.basename(file)} (${fileIndex + 1}/${options.files.length}) for ${options.sourceKey}...`)
        const reader = createInterface({
            input: createReadStream(file, { encoding: "utf8" }),
            crlfDelay: Infinity,
        })
        for await (const line of reader) {
            lineCount += 1
            totalLines += 1
            if (!line.trim()) continue
            const rows = parseLine(line)
            parsedRows += rows.length
            fileParsedRows += rows.length
            for (const row of rows) {
                if (!shouldImportRow(row, options)) {
                    skippedRows += 1
                    fileSkippedRows += 1
                    continue
                }
                const record = helpers.sunbizShardRecordFromOwnerRow(row)
                if (!record) {
                    skippedRows += 1
                    fileSkippedRows += 1
                    continue
                }
                const shardKeys = helpers.sunbizShardKeysForName(record.n, options.prefixLength)
                for (const shardKey of shardKeys) {
                    writer.write(path.join(outputSourceDir, `${shardKey}.jsonl`), `${JSON.stringify(record)}\n`)
                }
                writtenRows += 1
                fileWrittenRows += 1
            }
            if (lineCount >= nextProgressLine) {
                console.log(`stage=progress file=${fileIndex + 1}/${options.files.length} lines=${lineCount.toLocaleString()} parsed=${fileParsedRows.toLocaleString()} written=${fileWrittenRows.toLocaleString()} skipped=${fileSkippedRows.toLocaleString()} elapsed=${elapsed(startedAt)}`)
                nextProgressLine += options.progressLines
            }
        }
        console.log(`stage=complete file=${fileIndex + 1}/${options.files.length} lines=${lineCount.toLocaleString()} parsed=${fileParsedRows.toLocaleString()} written=${fileWrittenRows.toLocaleString()} skipped=${fileSkippedRows.toLocaleString()} elapsed=${elapsed(startedAt)}`)
    }

    await writer.closeAll()
    const files = writer.files()
    console.log(`Compressing ${files.length.toLocaleString()} shard file${files.length === 1 ? "" : "s"}...`)
    for (let index = 0; index < files.length; index += 1) {
        await gzipFile(files[index], options.keepJsonl)
        if ((index + 1) % 500 === 0) console.log(`stage=compress progress=${(index + 1).toLocaleString()}/${files.length.toLocaleString()} elapsed=${elapsed(startedAt)}`)
    }

    const outputBytes = directorySizeBytes(path.join(options.outDir, options.version, sourcePath))
    return {
        status: "ok",
        sourceKey: options.sourceKey,
        version: options.version,
        sourcePath,
        prefixLength: options.prefixLength,
        files: options.files.length,
        totalLines,
        parsedRows,
        writtenRows,
        skippedRows,
        shardFiles: files.length,
        outputDir: path.join(options.outDir, options.version, sourcePath),
        outputSize: formatBytes(outputBytes),
    }
}

async function main() {
    const [helpers, parsers] = await Promise.all([loadSunbizShardHelpers(), loadSunbizParsers()])
    const options = parseArgs(process.argv.slice(2), helpers)
    if (!options.sourceKey || options.files.length === 0) {
        console.error(usage())
        process.exitCode = 1
        return
    }
    const result = await buildShards(options, helpers, parsers)
    console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
})
