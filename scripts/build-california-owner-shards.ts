import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { pathToFileURL } from "node:url"
import { createGzip } from "node:zlib"

import type {
    CaliforniaOwnerIndexRow,
    CaliforniaOwnerShardRecord,
    CaliforniaOwnerShardSourceKey,
} from "../lib/leadgen/california-owner-shards"

type CaliforniaOwnerShardHelpers = {
    CALIFORNIA_OWNER_DEFAULT_SHARD_PREFIX_LENGTH: number
    CALIFORNIA_OWNER_SHARD_VERSION: string
    californiaOwnerShardKeysForName: (value: string | null | undefined, prefixLength?: number) => string[]
    californiaOwnerShardRecordFromRow: (row: CaliforniaOwnerIndexRow) => CaliforniaOwnerShardRecord | null
    californiaOwnerShardSourceKeys: readonly CaliforniaOwnerShardSourceKey[]
    californiaOwnerShardSourcePath: (sourceKey: CaliforniaOwnerShardSourceKey) => string
}

type CliOptions = {
    sourceKeys: CaliforniaOwnerShardSourceKey[]
    outDir: string
    version: string
    prefixLength: number
    keepJsonl: boolean
    pageSize: number
    progressRows: number
    limit: number | null
}

type ArcgisFeature = {
    attributes?: Record<string, unknown>
    geometry?: { x?: number; y?: number }
}

type ArcgisResponse = {
    features?: ArcgisFeature[]
    exceededTransferLimit?: boolean
    error?: { message?: string; details?: string[] }
}

type SourceDefinition = {
    sourceKey: CaliforniaOwnerShardSourceKey
    label: string
    fetchRows: (options: CliOptions) => AsyncGenerator<CaliforniaOwnerIndexRow>
}

function asString(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function pickString(row: Record<string, unknown>, fields: string[]) {
    for (const field of fields) {
        const value = asString(row[field])
        if (value) return value
    }
    return null
}

function cleanName(value: string | null | undefined) {
    return (value ?? "")
        .replace(/\s+/g, " ")
        .replace(/\b(?:null|n\/a|none|unknown)\b/gi, " ")
        .trim()
}

function stableRecordId(sourceKey: CaliforniaOwnerShardSourceKey, row: Record<string, unknown>, fields: string[]) {
    const picked = pickString(row, fields)
    if (picked) return picked
    const raw = JSON.stringify(row)
    let hash = 0
    for (let index = 0; index < raw.length; index += 1) {
        hash = ((hash << 5) - hash + raw.charCodeAt(index)) | 0
    }
    return `${sourceKey}:${Math.abs(hash)}`
}

function usage() {
    return [
        "Usage:",
        "  npm run build:ca-owner-shards -- --source all --out .california-owner-shards",
        "  npm run build:ca-owner-shards -- --source registry.ca.los_angeles_fbn --out .california-owner-shards",
        "",
        "Options:",
        "  --source all|registry.ca.los_angeles_fbn|registry.ca.san_francisco_business_locations|registry.ca.san_diego_business_tax|regulated.ca.calrecycle_waste",
        "  --prefix-length 3      Business-name shard prefix length.",
        "  --page-size 2000       API page size for source downloads.",
        "  --limit 10000          Optional source-row cap for dry test builds.",
        "  --keep-jsonl           Keep uncompressed .jsonl files after .jsonl.gz files are written.",
        "  --progress-rows 25000  Print progress while downloading/building.",
    ].join("\n")
}

async function loadCaliforniaOwnerShardHelpers() {
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "lib/leadgen/california-owner-shards.ts")).href
    return await import(moduleUrl) as CaliforniaOwnerShardHelpers
}

function parseSourceKeys(value: string | null | undefined, supportedSourceKeys: readonly CaliforniaOwnerShardSourceKey[]) {
    if (!value || value === "all") return [...supportedSourceKeys]
    const keys = value.split(",").map((item) => item.trim()).filter(Boolean)
    const invalid = keys.filter((key) => !supportedSourceKeys.includes(key as CaliforniaOwnerShardSourceKey))
    if (invalid.length) throw new Error(`Unsupported California owner shard source: ${invalid.join(", ")}`)
    return keys as CaliforniaOwnerShardSourceKey[]
}

function parseArgs(argv: string[], helpers: Pick<CaliforniaOwnerShardHelpers, "CALIFORNIA_OWNER_DEFAULT_SHARD_PREFIX_LENGTH" | "CALIFORNIA_OWNER_SHARD_VERSION" | "californiaOwnerShardSourceKeys">): CliOptions {
    const options: CliOptions = {
        sourceKeys: [...helpers.californiaOwnerShardSourceKeys],
        outDir: ".california-owner-shards",
        version: helpers.CALIFORNIA_OWNER_SHARD_VERSION,
        prefixLength: helpers.CALIFORNIA_OWNER_DEFAULT_SHARD_PREFIX_LENGTH,
        keepJsonl: false,
        pageSize: 2_000,
        progressRows: 25_000,
        limit: null,
    }
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]
        if (arg === "--source" || arg === "--sourceKey") {
            options.sourceKeys = parseSourceKeys(argv[index + 1], helpers.californiaOwnerShardSourceKeys)
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
        } else if (arg === "--page-size") {
            options.pageSize = Math.min(50_000, Math.max(100, Number(argv[index + 1]) || options.pageSize))
            index += 1
        } else if (arg === "--progress-rows") {
            options.progressRows = Math.max(1_000, Number(argv[index + 1]) || options.progressRows)
            index += 1
        } else if (arg === "--limit") {
            const value = Number(argv[index + 1])
            options.limit = Number.isFinite(value) && value > 0 ? Math.floor(value) : null
            index += 1
        } else if (arg === "--keep-jsonl") {
            options.keepJsonl = true
        }
    }
    return options
}

async function fetchJson(url: string) {
    const response = await fetch(url, {
        headers: {
            Accept: "application/json",
            "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)",
        },
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 280)}`)
    return JSON.parse(text) as unknown
}

async function fetchText(url: string) {
    const response = await fetch(url, {
        headers: {
            Accept: "text/csv,text/plain,*/*",
            "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)",
        },
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 280)}`)
    return text
}

function parseCsvLine(line: string) {
    const cells: string[] = []
    let current = ""
    let quoted = false
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index]
        const next = line[index + 1]
        if (char === "\"" && quoted && next === "\"") {
            current += "\""
            index += 1
            continue
        }
        if (char === "\"") {
            quoted = !quoted
            continue
        }
        if (char === "," && !quoted) {
            cells.push(cleanName(current))
            current = ""
            continue
        }
        current += char
    }
    cells.push(cleanName(current))
    return cells
}

function csvRowsWithHeaders(csv: string) {
    const [headerLine, ...lines] = csv.split(/\r?\n/).filter((line) => line.trim())
    const headers = parseCsvLine(headerLine ?? "")
    return lines.map((line) => {
        const cells = parseCsvLine(line)
        return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))
    })
}

function joinStreetParts(row: Record<string, unknown>, fields: string[]) {
    return cleanName(fields.map((field) => pickString(row, [field])).filter(Boolean).join(" ")) || null
}

async function *fetchArcgisAttributes({
    serviceUrl,
    pageSize,
    limit,
}: {
    serviceUrl: string
    pageSize: number
    limit: number | null
}) {
    let offset = 0
    let emitted = 0
    while (limit === null || emitted < limit) {
        const count = limit === null ? pageSize : Math.min(pageSize, limit - emitted)
        const params = new URLSearchParams({
            f: "json",
            where: "1=1",
            outFields: "*",
            resultOffset: String(offset),
            resultRecordCount: String(count),
            returnGeometry: "true",
        })
        const parsed = await fetchJson(`${serviceUrl.replace(/\/$/, "")}/query?${params.toString()}`) as ArcgisResponse
        if (parsed.error) throw new Error(`ArcGIS query failed: ${parsed.error.message ?? "unknown error"} ${(parsed.error.details ?? []).join(" ")}`.trim())
        const features = parsed.features ?? []
        for (const feature of features) {
            emitted += 1
            yield {
                ...(feature.attributes ?? {}),
                longitude: feature.attributes?.Longitude ?? feature.attributes?.longitude ?? feature.geometry?.x,
                latitude: feature.attributes?.Latitude ?? feature.attributes?.latitude ?? feature.geometry?.y,
            }
        }
        if (features.length < count || features.length === 0) break
        offset += features.length
    }
}

async function *fetchSocrataRows({
    domain,
    datasetId,
    where,
    pageSize,
    limit,
}: {
    domain: string
    datasetId: string
    where?: string
    pageSize: number
    limit: number | null
}) {
    let offset = 0
    let emitted = 0
    while (limit === null || emitted < limit) {
        const count = limit === null ? pageSize : Math.min(pageSize, limit - emitted)
        const params = new URLSearchParams({
            "$limit": String(count),
            "$offset": String(offset),
        })
        if (where) params.set("$where", where)
        const parsed = await fetchJson(`https://${domain}/resource/${datasetId}.json?${params.toString()}`)
        const rows = Array.isArray(parsed) ? parsed.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row))) : []
        for (const row of rows) {
            emitted += 1
            yield row
        }
        if (rows.length < count || rows.length === 0) break
        offset += rows.length
    }
}

async function *fetchLosAngelesFbnRows(options: CliOptions): AsyncGenerator<CaliforniaOwnerIndexRow> {
    const serviceUrl = "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Fictitious_Business_Name/FeatureServer/0"
    for await (const row of fetchArcgisAttributes({ serviceUrl, pageSize: options.pageSize, limit: options.limit })) {
        const businessName = pickString(row, ["BusinessName"])
        const personName = cleanName(pickString(row, ["RegisteredOwnerName"]))
        if (!businessName || !personName) continue
        yield {
            source_key: "registry.ca.los_angeles_fbn",
            business_name: businessName,
            record_id: stableRecordId("registry.ca.los_angeles_fbn", row, ["FilingNumber", "OBJECTID"]),
            person_name: personName,
            person_role: "registered_fbn_owner",
            person_source_field: "RegisteredOwnerName",
            status: pickString(row, ["FilingType"]),
            record_type: pickString(row, ["BusinessType"]) ?? "Los Angeles County FBN",
            address: {
                street: pickString(row, ["BusinessAddress"]),
                city: pickString(row, ["BusinessCity"]),
                state: pickString(row, ["BusinessState"]) ?? "CA",
                postcode: pickString(row, ["BusinessZipCode"]),
            },
            source_url: "https://public.gis.lacounty.gov/portal/apps/sites/#/opendata/items/2401223c34864b7b9e5884b6229a1d3c",
            raw_payload: row,
        }
    }
}

async function *fetchSanFranciscoBusinessRows(options: CliOptions): AsyncGenerator<CaliforniaOwnerIndexRow> {
    for await (const row of fetchSocrataRows({
        domain: "data.sfgov.org",
        datasetId: "g8m3-pdis",
        where: "dba_end_date IS NULL AND location_end_date IS NULL",
        pageSize: options.pageSize,
        limit: options.limit,
    })) {
        const businessName = pickString(row, ["dba_name"])
        const personName = cleanName(pickString(row, ["ownership_name"]))
        if (!businessName || !personName) continue
        yield {
            source_key: "registry.ca.san_francisco_business_locations",
            business_name: businessName,
            record_id: stableRecordId("registry.ca.san_francisco_business_locations", row, ["uniqueid", "certificate_number", "ttxid"]),
            person_name: personName,
            person_role: "business_owner",
            person_source_field: "ownership_name",
            status: "Active",
            record_type: "San Francisco registered business location",
            address: {
                street: pickString(row, ["full_business_address", "street_address"]),
                city: pickString(row, ["city"]) ?? "San Francisco",
                state: pickString(row, ["state"]) ?? "CA",
                postcode: pickString(row, ["business_zip", "mail_zipcode"]),
            },
            source_url: "https://data.sfgov.org/Economy-and-Community/Registered-Business-Locations-San-Francisco/g8m3-pdis",
            raw_payload: row,
        }
    }
}

async function *fetchSanDiegoBusinessTaxRows(options: CliOptions): AsyncGenerator<CaliforniaOwnerIndexRow> {
    const sourceUrl = "https://seshat.datasd.org/business_tax_certificates/sd_businesses_active_datasd.csv"
    const csv = await fetchText(sourceUrl)
    let emitted = 0
    for (const row of csvRowsWithHeaders(csv)) {
        if (options.limit !== null && emitted >= options.limit) break
        const businessName = pickString(row, ["dba_name"])
        const personName = cleanName(pickString(row, ["business_owner_name"]))
        if (!businessName || !personName) continue
        emitted += 1
        yield {
            source_key: "registry.ca.san_diego_business_tax",
            business_name: businessName,
            record_id: stableRecordId("registry.ca.san_diego_business_tax", row, ["account_key"]),
            person_name: personName,
            person_role: "business_tax_certificate_owner",
            person_source_field: "business_owner_name",
            status: pickString(row, ["account_status"]) ?? "Active",
            record_type: pickString(row, ["ownership_type"]) ?? "San Diego business tax certificate",
            address: {
                street: joinStreetParts(row, ["address_no", "address_pd", "address_road", "address_sfx", "address_no_fraction", "address_suite"]),
                city: pickString(row, ["address_city"]) ?? "San Diego",
                state: pickString(row, ["address_state"]) ?? "CA",
                postcode: pickString(row, ["address_zip"]),
            },
            source_url: "https://data.sandiego.gov/datasets/business-tax-certificates/",
            raw_payload: row,
        }
    }
}

async function *fetchCalRecycleRows(options: CliOptions): AsyncGenerator<CaliforniaOwnerIndexRow> {
    const serviceUrl = "https://services3.arcgis.com/6CawrotsIAWp4yUX/ArcGIS/rest/services/CalRecycle_Solid_Waste_Facilities/FeatureServer/0"
    for await (const row of fetchArcgisAttributes({ serviceUrl, pageSize: options.pageSize, limit: options.limit })) {
        const businessName = pickString(row, ["Site_Name", "Reporting_Agency_Legal_Name"])
        const personName = cleanName(pickString(row, ["Point_of_Contact"]))
        if (!businessName || !personName) continue
        yield {
            source_key: "regulated.ca.calrecycle_waste",
            business_name: businessName,
            record_id: stableRecordId("regulated.ca.calrecycle_waste", row, ["SWIS_Number", "OBJECTID"]),
            person_name: personName,
            person_role: "facility_point_of_contact",
            person_source_field: "Point_of_Contact",
            status: pickString(row, ["OperationalStatus"]),
            record_type: pickString(row, ["Activity", "Category", "Facility_Type"]) ?? "CalRecycle facility",
            address: {
                street: pickString(row, ["Street_Address"]),
                city: pickString(row, ["City"]),
                state: pickString(row, ["State"]) ?? "CA",
                postcode: pickString(row, ["ZIP_Code"]),
            },
            source_url: "https://calrecycle.ca.gov/",
            raw_payload: row,
        }
    }
}

const SOURCE_DEFINITIONS: Record<CaliforniaOwnerShardSourceKey, SourceDefinition> = {
    "registry.ca.los_angeles_fbn": {
        sourceKey: "registry.ca.los_angeles_fbn",
        label: "Los Angeles County FBN",
        fetchRows: fetchLosAngelesFbnRows,
    },
    "registry.ca.san_francisco_business_locations": {
        sourceKey: "registry.ca.san_francisco_business_locations",
        label: "San Francisco registered businesses",
        fetchRows: fetchSanFranciscoBusinessRows,
    },
    "registry.ca.san_diego_business_tax": {
        sourceKey: "registry.ca.san_diego_business_tax",
        label: "San Diego business tax certificates",
        fetchRows: fetchSanDiegoBusinessTaxRows,
    },
    "regulated.ca.calrecycle_waste": {
        sourceKey: "regulated.ca.calrecycle_waste",
        label: "CalRecycle waste records",
        fetchRows: fetchCalRecycleRows,
    },
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

async function buildSourceShards(definition: SourceDefinition, options: CliOptions, helpers: CaliforniaOwnerShardHelpers) {
    const sourcePath = helpers.californiaOwnerShardSourcePath(definition.sourceKey)
    const outputSourceDir = path.join(options.outDir, options.version, sourcePath)
    if (existsSync(outputSourceDir)) rmSync(outputSourceDir, { recursive: true, force: true })
    mkdirSync(outputSourceDir, { recursive: true })

    const writer = new ShardWriter()
    const startedAt = Date.now()
    let downloadedRows = 0
    let writtenRows = 0
    let skippedRows = 0
    let nextProgressRow = options.progressRows
    console.log(`Starting ${definition.label} (${definition.sourceKey})...`)
    for await (const row of definition.fetchRows(options)) {
        downloadedRows += 1
        const record = helpers.californiaOwnerShardRecordFromRow(row)
        if (!record) {
            skippedRows += 1
            continue
        }
        const shardKeys = helpers.californiaOwnerShardKeysForName(record.n, options.prefixLength)
        for (const shardKey of shardKeys) {
            writer.write(path.join(outputSourceDir, `${shardKey}.jsonl`), `${JSON.stringify(record)}\n`)
        }
        writtenRows += 1
        if (downloadedRows >= nextProgressRow) {
            console.log(`stage=progress source=${definition.sourceKey} rows=${downloadedRows.toLocaleString()} written=${writtenRows.toLocaleString()} skipped=${skippedRows.toLocaleString()} elapsed=${elapsed(startedAt)}`)
            nextProgressRow += options.progressRows
        }
    }
    await writer.closeAll()
    const files = writer.files()
    console.log(`Compressing ${files.length.toLocaleString()} ${definition.label} shard file${files.length === 1 ? "" : "s"}...`)
    for (let index = 0; index < files.length; index += 1) {
        await gzipFile(files[index], options.keepJsonl)
        if ((index + 1) % 500 === 0) console.log(`stage=compress source=${definition.sourceKey} progress=${(index + 1).toLocaleString()}/${files.length.toLocaleString()} elapsed=${elapsed(startedAt)}`)
    }
    const outputBytes = directorySizeBytes(outputSourceDir)
    console.log(`stage=complete source=${definition.sourceKey} rows=${downloadedRows.toLocaleString()} written=${writtenRows.toLocaleString()} skipped=${skippedRows.toLocaleString()} shards=${files.length.toLocaleString()} size=${formatBytes(outputBytes)} elapsed=${elapsed(startedAt)}`)
}

async function main() {
    const helpers = await loadCaliforniaOwnerShardHelpers()
    const options = parseArgs(process.argv.slice(2), helpers)
    if (options.sourceKeys.length === 0) {
        console.error(usage())
        throw new Error("Provide at least one California owner shard source.")
    }
    mkdirSync(options.outDir, { recursive: true })
    for (const sourceKey of options.sourceKeys) {
        await buildSourceShards(SOURCE_DEFINITIONS[sourceKey], options, helpers)
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
})
