export type LeadgenSeedSourceKey = "overture" | "osm" | "alltheplaces" | "foursquare_os_places"
export type LeadgenEnrichmentSourceKey =
    | "website"
    | "state_license.tx.tdlr"
    | "state_license.fl.electrical"
    | "state_license.nc.general_contractors"
    | "sam_gov"
export type LeadgenLegacySourceKey = "state_licensing"
export type LeadgenSourceKey = LeadgenSeedSourceKey | LeadgenEnrichmentSourceKey | LeadgenLegacySourceKey
export type LeadgenConfigKey = LeadgenSourceKey | "icp"

export type LeadgenSourceConfig = Partial<Record<LeadgenConfigKey, {
    industries?: string[]
    locations?: string[]
    enabled?: boolean
    limit?: number
    maxEnrichmentDepth?: number
    ownerRequired?: boolean
    radiusMeters?: number
    crawlDepth?: number
    timeoutSeconds?: number
    respectRobots?: boolean
    release?: string
    notes?: string
}>>

export type LeadgenSourcePlanItem = {
    key: LeadgenSourceKey
    label: string
    detail: string
    kind: "seed" | "enrichment"
    category: "general" | "location" | "industry"
    industries: string[]
    locations: string[]
    limit: number | null
    radiusMeters: number | null
    crawlDepth: number | null
    timeoutSeconds: number | null
    respectRobots: boolean | null
    release: string | null
    notes: string | null
}

export type LeadgenSourceOption = {
    value: Exclude<LeadgenSourceKey, LeadgenLegacySourceKey>
    label: string
    detail: string
    statusLabel: string
    notesPlaceholder: string
    kind: "seed" | "enrichment"
    category: "general" | "location" | "industry"
    implemented?: boolean
    envVar?: string
    setupHint?: string
}

export const seedLeadgenSources = new Set<LeadgenSourceKey>(["overture", "osm", "alltheplaces", "foursquare_os_places"])
export const enrichmentLeadgenSources = new Set<LeadgenSourceKey>([
    "website",
    "state_license.tx.tdlr",
    "state_license.fl.electrical",
    "state_license.nc.general_contractors",
    "sam_gov",
])
export const stateLicensingSourceKeys = new Set<LeadgenSourceKey>([
    "state_license.tx.tdlr",
    "state_license.fl.electrical",
    "state_license.nc.general_contractors",
    "state_licensing",
])
export const executableLeadgenSources = new Set<LeadgenSourceKey>([
    ...seedLeadgenSources,
    ...enrichmentLeadgenSources,
    "state_licensing",
])

export const leadgenSourceOptions: LeadgenSourceOption[] = [
    {
        value: "overture",
        label: "Overture Places",
        detail: "Primary open places database. Uses ICP mappings to query Overture categories and regions from the public GeoParquet dataset.",
        statusLabel: "Executable, no key",
        notesPlaceholder: "Release pin, category exclusions, confidence thresholds, or bounding-box notes.",
        kind: "seed",
        category: "general",
        implemented: true,
        setupHint: "No API key is needed. Betelgeze queries Overture's public GeoParquet release with DuckDB.",
    },
    {
        value: "osm",
        label: "OpenStreetMap raw data",
        detail: "Secondary seed source from public OSM data through Overpass. Runs with tight mapped location/category tasks to avoid abusing free public infrastructure.",
        statusLabel: "Executable, no key",
        notesPlaceholder: "OSM tags, fallback search terms, or public Overpass caution notes.",
        kind: "seed",
        category: "general",
        implemented: true,
        setupHint: "No API key is needed. The worker spaces requests across public Overpass endpoints and keeps per-task limits conservative.",
    },
    {
        value: "alltheplaces",
        label: "AllThePlaces",
        detail: "Secondary seed source from the public AllThePlaces run archive. Reads only small matching GeoJSON files by ZIP byte range instead of downloading the full archive.",
        statusLabel: "Executable, no key",
        notesPlaceholder: "Release id, spider exclusions, or brand/category notes.",
        kind: "seed",
        category: "general",
        implemented: true,
        setupHint: "No API key is needed. The worker uses the latest public run unless a release id is pinned.",
    },
    {
        value: "foursquare_os_places",
        label: "Foursquare OS Places",
        detail: "Secondary seed source from Foursquare OS Places PMTiles. Requires a configured PMTiles URL from the Foursquare Places Portal or another accessible mirror.",
        statusLabel: "Executable after PMTiles URL is configured",
        notesPlaceholder: "PMTiles source, category terms, or coverage limitations.",
        kind: "seed",
        category: "general",
        implemented: true,
        envVar: "FOURSQUARE_OS_PLACES_PMTILES_URL",
        setupHint: "Add FOURSQUARE_OS_PLACES_PMTILES_URL in Vercel. The source cannot run without a byte-range-readable PMTiles URL.",
    },
    {
        value: "website",
        label: "Website crawler",
        detail: "Owner and phone discovery from collected candidate websites. Runs after seed candidates exist.",
        statusLabel: "Executable after candidates exist",
        notesPlaceholder: "Pages to inspect, owner-title patterns, or domains to skip.",
        kind: "enrichment",
        category: "general",
        implemented: true,
    },
    {
        value: "state_license.tx.tdlr",
        label: "Texas TDLR licensing",
        detail: "Texas Department of Licensing and Regulation adapter for mapped trades such as HVAC, electrical, and water well services.",
        statusLabel: "Executable for mapped Texas licensing categories",
        notesPlaceholder: "License statuses, endorsements, counties, or Texas exclusions.",
        kind: "enrichment",
        category: "industry",
        implemented: true,
    },
    {
        value: "state_license.fl.electrical",
        label: "Florida DBPR electrical records",
        detail: "Florida DBPR electrical contractor CSV enrichment for Florida candidates in mapped electrical-adjacent industries.",
        statusLabel: "Executable for mapped Florida electrical categories",
        notesPlaceholder: "License status rules, Florida county/city caveats, or DBPR match confidence notes.",
        kind: "enrichment",
        category: "industry",
        implemented: true,
    },
    {
        value: "state_license.nc.general_contractors",
        label: "North Carolina general contractor search",
        detail: "North Carolina Licensing Board for General Contractors search for mapped NC contractor/remodelling candidates.",
        statusLabel: "Executable for mapped North Carolina GC categories",
        notesPlaceholder: "Classification ids, active-status rules, or name matching notes.",
        kind: "enrichment",
        category: "industry",
        implemented: true,
    },
    {
        value: "sam_gov",
        label: "SAM.gov",
        detail: "Very scarce validation/enrichment for mapped NAICS, entity identity, and public POC evidence. Kept to one mapped task per poll because basic API quotas are strict.",
        statusLabel: "Executable with key, rate-limited hard",
        notesPlaceholder: "NAICS filters, POC confidence rules, or entity-status constraints.",
        kind: "enrichment",
        category: "industry",
        implemented: true,
        envVar: "SAM_GOV_API_KEY",
        setupHint: "Add SAM_GOV_API_KEY in Vercel. Betelgeze only runs this source sparingly because SAM.gov quota windows are tight.",
    },
]

const optionByKey = new Map<LeadgenSourceKey, LeadgenSourceOption | { value: LeadgenLegacySourceKey; label: string; detail: string; kind: "enrichment"; category: "industry" }>([
    ...leadgenSourceOptions.map((source) => [source.value, source] as const),
    ["state_licensing", { value: "state_licensing", label: "State licensing boards (legacy)", detail: "Legacy saved setting mapped to the split board adapters.", kind: "enrichment", category: "industry" }],
])

export function normaliseLeadgenSourceKey(value: string): LeadgenSourceKey | null {
    if (optionByKey.has(value as LeadgenSourceKey)) return value as LeadgenSourceKey
    return null
}

export function sourceLabel(key: string) {
    return optionByKey.get(key as LeadgenSourceKey)?.label ?? key
}

export function buildSourcePlan(enabledSources: string[], sourceConfig: Partial<LeadgenSourceConfig> | null | undefined): LeadgenSourcePlanItem[] {
    const icpConfig = sourceConfig?.icp
    const industries = Array.isArray(icpConfig?.industries) ? icpConfig.industries.map(String).filter(Boolean) : []
    const locations = Array.isArray(icpConfig?.locations) ? icpConfig.locations.map(String).filter(Boolean) : []
    return enabledSources
        .map(normaliseLeadgenSourceKey)
        .filter((key): key is LeadgenSourceKey => Boolean(key))
        .map((key) => {
            const option = optionByKey.get(key)!
            const sourceSpecificConfig = sourceConfig?.[key]
            return {
                key,
                label: option.label,
                detail: option.detail,
                kind: option.kind,
                category: option.category,
                industries,
                locations,
                limit: typeof sourceSpecificConfig?.limit === "number" ? sourceSpecificConfig.limit : typeof icpConfig?.limit === "number" ? icpConfig.limit : null,
                radiusMeters: typeof sourceSpecificConfig?.radiusMeters === "number" ? sourceSpecificConfig.radiusMeters : null,
                crawlDepth: typeof sourceSpecificConfig?.crawlDepth === "number" ? sourceSpecificConfig.crawlDepth : null,
                timeoutSeconds: typeof sourceSpecificConfig?.timeoutSeconds === "number" ? sourceSpecificConfig.timeoutSeconds : null,
                respectRobots: typeof sourceSpecificConfig?.respectRobots === "boolean" ? sourceSpecificConfig.respectRobots : null,
                release: sourceSpecificConfig?.release?.trim() || null,
                notes: sourceSpecificConfig?.notes?.trim() || icpConfig?.notes?.trim() || null,
            }
        })
}
