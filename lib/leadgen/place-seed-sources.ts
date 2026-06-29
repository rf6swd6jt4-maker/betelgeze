import { VectorTile, type VectorTileFeature } from "@mapbox/vector-tile"
import { PMTiles } from "pmtiles"
import { PbfReader } from "pbf"
import { inflateRawSync } from "node:zlib"

export type PlaceSeedLocation = {
    label?: string | null
    latitude?: number | null
    longitude?: number | null
    radiusMeters?: number | null
}

export type PlaceSeedRecord = {
    id: string
    name: string | null
    phone: string | null
    website_url: string | null
    profile_url: string | null
    address: Record<string, unknown>
    latitude: number | null
    longitude: number | null
    categories: Array<{ key: string; value: string }>
    raw_payload: Record<string, unknown>
}

type ZipEntry = {
    name: string
    compression: number
    compressedSize: number
    uncompressedSize: number
    localHeaderOffset: number
}

type AllThePlacesRun = {
    run_id?: string
    output_url?: string
    size_bytes?: number
    start_time?: string
}

const ATP_HISTORY_URL = "https://data.alltheplaces.xyz/runs/history.json"
const ATP_TAIL_BYTES = 1_048_576
const ATP_MAX_ENTRY_BYTES = 1_500_000
const ATP_MAX_FILES_PER_TASK = 8
const DEFAULT_TIMEOUT_MS = 18_000
const FOURSQUARE_DEFAULT_ZOOM = 13

const zipDirectoryCache = new Map<string, Promise<{ url: string; size: number; entries: ZipEntry[] }>>()

const ATP_INDUSTRY_TERMS: Record<string, string[]> = {
    bathroom_remodelling: ["bath", "home", "hardware"],
    concrete_contractors: ["concrete", "construction", "building"],
    deck_builders: ["deck", "home", "hardware", "lumber"],
    electricians: ["electric", "electrical", "lighting"],
    fencing_contractors: ["fence", "fencing", "home", "hardware"],
    flooring_contractors: ["floor", "flooring", "carpet", "tile"],
    garage_door_companies: ["garage", "door"],
    general_contractors: ["contract", "construction", "builder", "home", "hardware"],
    home_builders: ["builder", "construction", "home"],
    hvac_contractors: ["hvac", "heating", "cooling", "air_conditioning"],
    kitchen_remodelling: ["kitchen", "home", "hardware"],
    landscapers: ["garden", "landscape", "lawn", "nursery"],
    lawn_care_companies: ["lawn", "garden", "landscape"],
    painters: ["paint", "paints"],
    plumbers: ["plumb", "plumbing"],
    pool_builders: ["pool", "pools", "swimming"],
    remodellers: ["remodel", "home", "hardware", "construction"],
    restoration_companies: ["restoration", "repair", "home"],
    roofers: ["roof", "roofing"],
    siding_contractors: ["siding", "home", "exterior"],
    solar_installers: ["solar", "electric"],
    tree_services: ["tree_service", "arborist", "garden"],
    water_well_services: ["well", "pump", "water"],
    window_and_door_contractors: ["window", "door", "glazier"],
}

const ATP_FILE_REJECT_TERMS = [
    "city_council",
    "county_council",
    "town_council",
    "street_lamp",
    "street_light",
    "street_pole",
    "traffic_",
    "parks_and_recreation",
    "trees_",
    "_trees_",
    "substations",
    "transformers",
    "cameras",
    "waste_baskets",
]

function cleanTerm(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

function compactTerms(values: string[]) {
    return [...new Set(values.flatMap((value) => cleanTerm(value).split("_")).filter((value) => value.length >= 3))]
}

function bboxForRadius(latitude: number, longitude: number, radiusMeters: number) {
    const latDelta = radiusMeters / 111_320
    const lonDelta = radiusMeters / (111_320 * Math.cos(latitude * Math.PI / 180))
    return {
        minLat: latitude - latDelta,
        maxLat: latitude + latDelta,
        minLon: longitude - lonDelta,
        maxLon: longitude + lonDelta,
    }
}

function withinLocation(latitude: number | null, longitude: number | null, location: PlaceSeedLocation) {
    if (typeof latitude !== "number" || typeof longitude !== "number" || typeof location.latitude !== "number" || typeof location.longitude !== "number") return false
    const radiusMeters = Math.min(40_000, Math.max(1_000, location.radiusMeters ?? 24_000))
    const bbox = bboxForRadius(location.latitude, location.longitude, radiusMeters)
    return latitude >= bbox.minLat && latitude <= bbox.maxLat && longitude >= bbox.minLon && longitude <= bbox.maxLon
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function asNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : null
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetch(url, {
            ...init,
            headers: {
                "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)",
                ...(init.headers ?? {}),
            },
            signal: controller.signal,
            cache: "no-store",
        })
    } finally {
        clearTimeout(timeout)
    }
}

async function fetchBufferRange(url: string, start: number, endInclusive: number) {
    const response = await fetchWithTimeout(url, {
        headers: { Range: `bytes=${start}-${endInclusive}` },
    })
    if (!response.ok && response.status !== 206) throw new Error(`Range request returned HTTP ${response.status}.`)
    return Buffer.from(await response.arrayBuffer())
}

async function latestAllThePlacesRun(release?: string | null) {
    const response = await fetchWithTimeout(ATP_HISTORY_URL)
    if (!response.ok) throw new Error(`AllThePlaces history returned HTTP ${response.status}.`)
    const runs = await response.json() as AllThePlacesRun[]
    const usableRuns = runs.filter((run) => run.output_url && run.size_bytes)
    const selected = release && release !== "latest"
        ? usableRuns.find((run) => run.run_id === release)
        : usableRuns[usableRuns.length - 1]
    if (!selected?.output_url || !selected.size_bytes) throw new Error("AllThePlaces did not expose a usable latest ZIP output.")
    return { url: selected.output_url, size: selected.size_bytes, runId: selected.run_id ?? selected.start_time ?? "latest" }
}

async function readZipDirectory(url: string, size: number) {
    const cacheKey = `${url}:${size}`
    let cached = zipDirectoryCache.get(cacheKey)
    if (!cached) {
        cached = (async () => {
            const tailStart = Math.max(0, size - ATP_TAIL_BYTES)
            const tail = await fetchBufferRange(url, tailStart, size - 1)
            let eocdOffset = -1
            for (let index = tail.length - 22; index >= 0; index -= 1) {
                if (tail.readUInt32LE(index) === 0x06054b50) {
                    eocdOffset = index
                    break
                }
            }
            if (eocdOffset < 0) throw new Error("Could not locate the AllThePlaces ZIP directory.")
            const centralDirectorySize = tail.readUInt32LE(eocdOffset + 12)
            const centralDirectoryOffset = tail.readUInt32LE(eocdOffset + 16)
            const directory = centralDirectoryOffset >= tailStart && centralDirectoryOffset + centralDirectorySize <= size
                ? tail.subarray(centralDirectoryOffset - tailStart, centralDirectoryOffset - tailStart + centralDirectorySize)
                : await fetchBufferRange(url, centralDirectoryOffset, centralDirectoryOffset + centralDirectorySize - 1)
            const entries: ZipEntry[] = []
            let offset = 0
            while (offset + 46 <= directory.length) {
                if (directory.readUInt32LE(offset) !== 0x02014b50) break
                const compression = directory.readUInt16LE(offset + 10)
                const compressedSize = directory.readUInt32LE(offset + 20)
                const uncompressedSize = directory.readUInt32LE(offset + 24)
                const fileNameLength = directory.readUInt16LE(offset + 28)
                const extraLength = directory.readUInt16LE(offset + 30)
                const commentLength = directory.readUInt16LE(offset + 32)
                const localHeaderOffset = directory.readUInt32LE(offset + 42)
                const name = directory.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8")
                entries.push({ name, compression, compressedSize, uncompressedSize, localHeaderOffset })
                offset += 46 + fileNameLength + extraLength + commentLength
            }
            return { url, size, entries }
        })()
        zipDirectoryCache.set(cacheKey, cached)
    }
    return cached
}

async function readZipEntry(url: string, entry: ZipEntry) {
    const header = await fetchBufferRange(url, entry.localHeaderOffset, entry.localHeaderOffset + 60 + entry.name.length)
    if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`AllThePlaces ZIP entry ${entry.name} had an invalid local header.`)
    const fileNameLength = header.readUInt16LE(26)
    const extraLength = header.readUInt16LE(28)
    const dataStart = entry.localHeaderOffset + 30 + fileNameLength + extraLength
    const compressed = await fetchBufferRange(url, dataStart, dataStart + entry.compressedSize - 1)
    if (entry.compression === 0) return compressed.toString("utf8")
    if (entry.compression === 8) return inflateRawSync(compressed).toString("utf8")
    throw new Error(`AllThePlaces ZIP entry ${entry.name} uses unsupported compression ${entry.compression}.`)
}

function candidateAtpEntries(entries: ZipEntry[], terms: string[]) {
    const compact = compactTerms(terms)
    return entries
        .filter((entry) => entry.name.endsWith(".geojson"))
        .filter((entry) => entry.compressedSize > 0 && entry.compressedSize <= ATP_MAX_ENTRY_BYTES)
        .filter((entry) => !ATP_FILE_REJECT_TERMS.some((term) => entry.name.includes(term)))
        .filter((entry) => compact.some((term) => entry.name.includes(term)))
        .slice(0, ATP_MAX_FILES_PER_TASK)
}

function atpFeatureToPlace(feature: Record<string, unknown>, entryName: string, runId: string): PlaceSeedRecord | null {
    const properties = asRecord(feature.properties)
    const geometry = asRecord(feature.geometry)
    const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : []
    const longitude = asNumber(coordinates[0])
    const latitude = asNumber(coordinates[1])
    const name = asString(properties.name) ?? asString(properties.brand)
    if (!name) return null
    const spider = asString(properties["@spider"]) ?? entryName.replace(/^output\/|\.geojson$/g, "")
    const sourceRecordId = asString(feature.id) ?? asString(properties.ref) ?? `${spider}:${name}:${latitude ?? ""}:${longitude ?? ""}`
    const websiteUrl = asString(properties.website) ?? asString(properties["contact:website"])
    const categories = [
        asString(properties.brand) ? { key: "brand", value: asString(properties.brand)! } : null,
        spider ? { key: "spider", value: spider } : null,
    ].filter((category): category is { key: string; value: string } => Boolean(category))
    return {
        id: `${runId}:${sourceRecordId}`,
        name,
        phone: asString(properties.phone) ?? asString(properties["contact:phone"]),
        website_url: websiteUrl,
        profile_url: asString(properties["@source_uri"]),
        address: {
            street: [asString(properties["addr:housenumber"]), asString(properties["addr:street"])].filter(Boolean).join(" ") || null,
            city: asString(properties["addr:city"]),
            state: asString(properties["addr:state"]),
            postcode: asString(properties["addr:postcode"]),
            country: asString(properties["addr:country"]),
        },
        latitude,
        longitude,
        categories,
        raw_payload: { feature, entry: entryName, run_id: runId },
    }
}

export async function queryAllThePlaces({
    terms,
    industry,
    location,
    limit,
    release,
    excludeIds = [],
}: {
    terms: string[]
    industry?: string | null
    location: PlaceSeedLocation
    limit: number
    release?: string | null
    excludeIds?: string[]
}) {
    if (!location.latitude || !location.longitude) throw new Error("AllThePlaces requires a target location with latitude and longitude.")
    const run = await latestAllThePlacesRun(release)
    const directory = await readZipDirectory(run.url, run.size)
    const searchTerms = [...terms, ...(industry ? ATP_INDUSTRY_TERMS[industry] ?? [] : [])]
    const entries = candidateAtpEntries(directory.entries, searchTerms)
    if (entries.length === 0) throw new Error(`AllThePlaces had no bounded spider files matching ${compactTerms(searchTerms).join(", ") || "this industry"}.`)
    const excluded = new Set(excludeIds)
    const places: PlaceSeedRecord[] = []
    for (const entry of entries) {
        if (places.length >= limit) break
        const text = await readZipEntry(run.url, entry)
        const payload = JSON.parse(text) as { features?: unknown[] }
        for (const rawFeature of payload.features ?? []) {
            if (places.length >= limit) break
            const place = atpFeatureToPlace(asRecord(rawFeature), entry.name, run.runId)
            if (!place || excluded.has(place.id)) continue
            if (!withinLocation(place.latitude, place.longitude, location)) continue
            places.push(place)
        }
    }
    return places
}

function lonToTileX(longitude: number, zoom: number) {
    return Math.floor((longitude + 180) / 360 * 2 ** zoom)
}

function latToTileY(latitude: number, zoom: number) {
    const radians = latitude * Math.PI / 180
    return Math.floor((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2 * 2 ** zoom)
}

function vectorTileFeatureToPlace(feature: VectorTileFeature, x: number, y: number, z: number, terms: string[]) {
    const geojson = feature.toGeoJSON(x, y, z)
    const properties = { ...feature.properties, ...asRecord(geojson.properties) }
    const text = JSON.stringify(properties).toLowerCase()
    const compact = compactTerms(terms)
    if (compact.length && !compact.some((term) => text.includes(term))) return null
    const coordinates = geojson.geometry && "coordinates" in geojson.geometry && Array.isArray(geojson.geometry.coordinates) ? geojson.geometry.coordinates as unknown[] : []
    const longitude = asNumber(coordinates[0])
    const latitude = asNumber(coordinates[1])
    const name = asString(properties.name) ?? asString(properties.name_en) ?? asString(properties.label)
    if (!name) return null
    const id = asString(properties.fsq_place_id) ?? asString(properties.id) ?? `${name}:${latitude ?? ""}:${longitude ?? ""}`
    const category = asString(properties.category) ?? asString(properties.category_name) ?? asString(properties.primary_category_name)
    return {
        id,
        name,
        phone: asString(properties.tel) ?? asString(properties.phone),
        website_url: asString(properties.website) ?? asString(properties.url),
        profile_url: id ? `https://foursquare.com/v/${id}` : null,
        address: {
            street: asString(properties.address) ?? asString(properties.address_extended),
            city: asString(properties.locality) ?? asString(properties.city),
            state: asString(properties.region) ?? asString(properties.state),
            postcode: asString(properties.postcode),
            country: asString(properties.country),
        },
        latitude,
        longitude,
        categories: [
            category ? { key: "category", value: category } : null,
            asString(properties.chain_name) ? { key: "chain", value: asString(properties.chain_name)! } : null,
        ].filter((item): item is { key: string; value: string } => Boolean(item)),
        raw_payload: { properties, z, x, y },
    } satisfies PlaceSeedRecord
}

export async function queryFoursquareOsPlaces({
    terms,
    location,
    limit,
    pmtilesUrl = process.env.FOURSQUARE_OS_PLACES_PMTILES_URL,
    excludeIds = [],
}: {
    terms: string[]
    location: PlaceSeedLocation
    limit: number
    pmtilesUrl?: string | null
    excludeIds?: string[]
}) {
    if (!pmtilesUrl) throw new Error("Foursquare OS Places is enabled, but FOURSQUARE_OS_PLACES_PMTILES_URL is not configured in Vercel.")
    if (!location.latitude || !location.longitude) throw new Error("Foursquare OS Places requires a target location with latitude and longitude.")
    const archive = new PMTiles(pmtilesUrl)
    const header = await archive.getHeader()
    const zoom = Math.min(header.maxZoom, Math.max(header.minZoom, FOURSQUARE_DEFAULT_ZOOM))
    const centerX = lonToTileX(location.longitude, zoom)
    const centerY = latToTileY(location.latitude, zoom)
    const excluded = new Set(excludeIds)
    const places: PlaceSeedRecord[] = []
    for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
            if (places.length >= limit) break
            const x = centerX + dx
            const y = centerY + dy
            const tile = await archive.getZxy(zoom, x, y)
            if (!tile?.data?.byteLength) continue
            const vectorTile = new VectorTile(new PbfReader(new Uint8Array(tile.data)))
            for (const layerName of Object.keys(vectorTile.layers)) {
                const layer = vectorTile.layers[layerName]
                for (let index = 0; index < layer.length; index += 1) {
                    if (places.length >= limit) break
                    const place = vectorTileFeatureToPlace(layer.feature(index), x, y, zoom, terms)
                    if (!place || excluded.has(place.id)) continue
                    if (!withinLocation(place.latitude, place.longitude, location)) continue
                    places.push(place)
                }
            }
        }
    }
    return places
}
