export type LeadgenSourceKey = "gbp_maps" | "state_licensing" | "secretary_of_state" | "aggregator_directories"
export type LeadgenConfigKey = LeadgenSourceKey | "icp"

export type LeadgenSourceConfig = Record<LeadgenConfigKey, {
    industries?: string[]
    locations?: string[]
    notes?: string
}>

export type LeadgenSourcePlanItem = {
    key: LeadgenSourceKey
    label: string
    detail: string
    industries: string[]
    locations: string[]
    notes: string | null
}

export const leadgenSourceOptions: Array<{ value: LeadgenSourceKey; label: string; detail: string; targetsLabel: string; targetsPlaceholder: string; notesPlaceholder: string }> = [
    {
        value: "gbp_maps",
        label: "GBP / Maps",
        detail: "Research surface for local presence, reviews, categories, and listing quality.",
        targetsLabel: "Search targets",
        targetsPlaceholder: "e.g. HVAC contractors in Dallas, roofers near Tampa",
        notesPlaceholder: "Categories, review thresholds, listing signals, or search exclusions.",
    },
    {
        value: "state_licensing",
        label: "State contractor licensing boards",
        detail: "License status, trade category, owner/licensee names, and service geography.",
        targetsLabel: "Boards / states / trades",
        targetsPlaceholder: "e.g. Texas HVAC, Florida roofing, California electrical",
        notesPlaceholder: "License statuses, classifications, renewal windows, or exclusions.",
    },
    {
        value: "secretary_of_state",
        label: "Secretary of State registries",
        detail: "Entity registration, legal name, age, officers, and addresses.",
        targetsLabel: "Registries / entity targets",
        targetsPlaceholder: "e.g. TX active LLCs, FL corporations, recently formed contractors",
        notesPlaceholder: "Officer patterns, entity age, legal suffix handling, or disqualifiers.",
    },
    {
        value: "aggregator_directories",
        label: "Aggregator directories",
        detail: "Angi, Yelp, and similar directories for coverage and reputation clues.",
        targetsLabel: "Directories / search targets",
        targetsPlaceholder: "e.g. Yelp plumbers Austin, Angi remodelers Phoenix",
        notesPlaceholder: "Directories to include, rating/review signals, sparse-profile signals.",
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
                notes: config?.notes?.trim() || sourceSpecificConfig?.notes?.trim() || null,
            }
        })
}
