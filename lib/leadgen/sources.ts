export type LeadgenSourceKey = "osm" | "state_licensing"
export type LeadgenConfigKey = LeadgenSourceKey | "icp"

export type LeadgenSourceConfig = Record<LeadgenConfigKey, {
    industries?: string[]
    locations?: string[]
    limit?: number
    radiusMeters?: number
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
    notes: string | null
}

export const leadgenSourceOptions: Array<{ value: LeadgenSourceKey; label: string; detail: string; targetsLabel: string; targetsPlaceholder: string; notesPlaceholder: string }> = [
    {
        value: "osm",
        label: "OpenStreetMap",
        detail: "Free structured business/location data through Overpass. No API key required.",
        targetsLabel: "Search targets",
        targetsPlaceholder: "e.g. HVAC contractors in Dallas, roofers near Tampa",
        notesPlaceholder: "OSM tags and fallback search terms to consider.",
    },
    {
        value: "state_licensing",
        label: "State licensing boards",
        detail: "Official public licensing records. First worker: Texas TDLR county/license searches.",
        targetsLabel: "Boards / states / trades",
        targetsPlaceholder: "e.g. Texas HVAC, electrical, water well",
        notesPlaceholder: "License statuses, classifications, renewal windows, or exclusions.",
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
    return enabledSources
        .map(normaliseLeadgenSourceKey)
        .filter((key): key is LeadgenSourceKey => Boolean(key))
        .map((key) => {
            const option = leadgenSourceOptions.find((source) => source.value === key)!
            const sourceSpecificConfig = sourceConfig?.[key]
            const config = key === "state_licensing" ? sourceSpecificConfig : icpConfig
            return {
                key,
                label: option.label,
                detail: option.detail,
                industries: Array.isArray(config?.industries) ? config.industries.map(String).filter(Boolean) : [],
                locations: Array.isArray(config?.locations) ? config.locations.map(String).filter(Boolean) : [],
                limit: typeof sourceSpecificConfig?.limit === "number" ? sourceSpecificConfig.limit : null,
                radiusMeters: typeof sourceSpecificConfig?.radiusMeters === "number" ? sourceSpecificConfig.radiusMeters : null,
                notes: config?.notes?.trim() || sourceSpecificConfig?.notes?.trim() || null,
            }
        })
}
