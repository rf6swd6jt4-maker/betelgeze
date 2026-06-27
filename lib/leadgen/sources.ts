export type LeadgenSourceKey = "overture" | "website" | "osm" | "state_licensing" | "opencorporates" | "sam_gov"
export type LeadgenConfigKey = LeadgenSourceKey | "icp"

export type LeadgenSourceConfig = Record<LeadgenConfigKey, {
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
}>

export type LeadgenSourcePlanItem = {
    key: LeadgenSourceKey
    label: string
    detail: string
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

export const executableLeadgenSources = new Set<LeadgenSourceKey>(["overture", "website", "osm", "state_licensing"])

export const leadgenSourceOptions: Array<{ value: LeadgenSourceKey; label: string; detail: string; statusLabel: string; notesPlaceholder: string; requiresApiKey?: boolean; implemented?: boolean; envVar?: string; setupHint?: string }> = [
    {
        value: "overture",
        label: "Overture Places",
        detail: "Primary open places database. Uses ICP mappings to query Overture categories and regions from the public GeoParquet dataset.",
        statusLabel: "Executable, no key",
        notesPlaceholder: "Release pin, category exclusions, confidence thresholds, or bounding-box notes.",
        implemented: true,
        setupHint: "No API key is needed. Betelgeze queries Overture's public GeoParquet release with DuckDB.",
    },
    {
        value: "website",
        label: "Website crawler",
        detail: "Owner and phone discovery from collected candidate websites. Runs after seed candidates exist.",
        statusLabel: "Executable after candidates exist",
        notesPlaceholder: "Pages to inspect, owner-title patterns, or domains to skip.",
    },
    {
        value: "osm",
        label: "OpenStreetMap",
        detail: "Support enrichment through Overpass using ICP-to-OSM category/location mappings. No API key required.",
        statusLabel: "Executable",
        notesPlaceholder: "OSM tags and fallback search terms to consider.",
        implemented: true,
    },
    {
        value: "state_licensing",
        label: "State licensing boards",
        detail: "Official public licensing records. First executable worker: Texas TDLR mapped automatically from the ICP.",
        statusLabel: "Executable for mapped Texas trades",
        notesPlaceholder: "License statuses, classifications, renewal windows, or exclusions.",
        implemented: true,
    },
    {
        value: "opencorporates",
        label: "Business registries",
        detail: "Officer/principal enrichment from free state SOS and local registry data. OpenCorporates is intentionally excluded from the default stack.",
        statusLabel: "Planned: state registry adapters",
        notesPlaceholder: "Enabled jurisdictions, officer confidence rules, registered-agent caveats, or SOS portals to prioritize.",
        setupHint: "Next target: direct state SOS datasets and public portal adapters, starting with Texas and other high-value service states.",
    },
    {
        value: "sam_gov",
        label: "SAM.gov",
        detail: "Validation-only federal contractor/entity source for NAICS, identity, and public POC evidence. Not suitable for bulk polling on a basic API quota.",
        statusLabel: "Validation-only, disabled for bulk polls",
        notesPlaceholder: "NAICS filters, POC confidence rules, or entity-status constraints.",
        requiresApiKey: true,
        envVar: "SAM_GOV_API_KEY",
        setupHint: "Basic SAM.gov keys are too limited for bulk polling. Keep this for later validation of already-ranked leads.",
    },
]

export function normaliseLeadgenSourceKey(value: string): LeadgenSourceKey | null {
    return leadgenSourceOptions.some((source) => source.value === value) ? value as LeadgenSourceKey : null
}

export function sourceLabel(key: string) {
    return leadgenSourceOptions.find((source) => source.value === key)?.label ?? key
}

export function buildSourcePlan(enabledSources: string[], sourceConfig: Partial<LeadgenSourceConfig> | null | undefined): LeadgenSourcePlanItem[] {
    const icpConfig = sourceConfig?.icp
    const industries = Array.isArray(icpConfig?.industries) ? icpConfig.industries.map(String).filter(Boolean) : []
    const locations = Array.isArray(icpConfig?.locations) ? icpConfig.locations.map(String).filter(Boolean) : []
    return enabledSources
        .map(normaliseLeadgenSourceKey)
        .filter((key): key is LeadgenSourceKey => Boolean(key))
        .map((key) => {
            const option = leadgenSourceOptions.find((source) => source.value === key)!
            const sourceSpecificConfig = sourceConfig?.[key]
            return {
                key,
                label: option.label,
                detail: option.detail,
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
