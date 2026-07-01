"use server"

import { revalidatePath } from "next/cache"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { storeWorkspaceImage } from "@/lib/onboarding/uploads"
import { executableLeadgenSources, leadgenSourceOptions, leadgenSourceRuntimeConfigured, normaliseLeadgenSourceKey, type LeadgenSourceCategoryIntentKey, type LeadgenSourceCategoryKey, type LeadgenSourceConfig, type LeadgenSourceKey, type LeadgenSourceSpecificConfig, type LeadgenSourceStageKey } from "@/lib/leadgen/sources"

type SourceMapping = { source_key: LeadgenSourceKey; icp_industry_value?: string | null; icp_location_value?: string | null; native_values?: string[] | null }
type SourceCatalogStageRow = { source_key: LeadgenSourceKey; stage_capabilities?: unknown }
type EnabledIcpValueRow = { value: string }

const SOURCE_CATEGORY_KEYS = new Set<LeadgenSourceCategoryKey>(["general", "industry", "location"])
const SOURCE_STAGE_KEYS = new Set<LeadgenSourceStageKey>(["business_validation", "owner_identity", "owner_phone", "phone_validation"])

function refresh(slug: string) {
    revalidatePath(`/leadgen/${slug}`)
    revalidatePath(`/leadgen/${slug}/settings`)
    revalidatePath(`/leadgen/${slug}/sources`)
    revalidatePath(`/dashboard/${slug}`)
    revalidatePath(`/dashboard/${slug}/settings`)
}

function boundedInteger(value: FormDataEntryValue | null, fallback: number, min: number, max: number) {
    const numeric = Number(value ?? fallback)
    return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.floor(numeric))) : fallback
}

function sourceLimitMax(sourceValue: string, sourceKind: string) {
    if (sourceValue === "overture") return 500
    if (sourceValue === "sam_gov") return 1
    if (sourceKind === "seed") return 25
    return 80
}

function sourceCategoryIntentKey(stageKey: LeadgenSourceStageKey, category: LeadgenSourceCategoryKey) {
    return `${stageKey}:${category}` as LeadgenSourceCategoryIntentKey
}

function normaliseSourceCategoryIntents(value: unknown) {
    const intents: Partial<Record<LeadgenSourceCategoryIntentKey, boolean>> = {}
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
    for (const [key, enabled] of Object.entries(record)) {
        const [stageKey, category] = key.split(":")
        if (!SOURCE_STAGE_KEYS.has(stageKey as LeadgenSourceStageKey) || !SOURCE_CATEGORY_KEYS.has(category as LeadgenSourceCategoryKey)) continue
        if (enabled) intents[sourceCategoryIntentKey(stageKey as LeadgenSourceStageKey, category as LeadgenSourceCategoryKey)] = true
    }
    return intents
}

function submittedSourceCategoryIntents(formData: FormData) {
    const intents: Partial<Record<LeadgenSourceCategoryIntentKey, boolean>> = {}
    for (const value of formData.getAll("sourceCategoryIntent")) {
        const [stageKey, category] = String(value).split(":")
        if (!SOURCE_STAGE_KEYS.has(stageKey as LeadgenSourceStageKey) || !SOURCE_CATEGORY_KEYS.has(category as LeadgenSourceCategoryKey)) continue
        intents[sourceCategoryIntentKey(stageKey as LeadgenSourceStageKey, category as LeadgenSourceCategoryKey)] = true
    }
    return intents
}

function stageCapabilities(value: unknown) {
    if (!Array.isArray(value)) return [] as LeadgenSourceStageKey[]
    return value
        .map((item) => item && typeof item === "object" && "stage_key" in item ? String(item.stage_key) : null)
        .filter((item): item is LeadgenSourceStageKey => item === "business_validation" || item === "owner_identity" || item === "owner_phone" || item === "phone_validation")
}

function fallbackSourceStages(sourceKey: LeadgenSourceKey): LeadgenSourceStageKey[] {
    if (sourceKey === "phone.basic_format_validation") return ["phone_validation"]
    if (sourceKey === "sam_gov") return ["business_validation"]
    if (sourceKey === "transport.fmcsa_safer") return ["business_validation"]
    if (sourceKey === "safety.osha" || sourceKey === "procurement.usaspending" || sourceKey === "web.rdap_whois" || sourceKey === "web.certificate_transparency") return ["business_validation"]
    if (sourceKey.startsWith("permits.") || sourceKey === "regulated.epa_echo") return ["business_validation"]
    if (sourceKey === "regulated.tx.tceq_waste" || sourceKey === "regulated.ca.calrecycle_waste") return ["owner_identity"]
    if (sourceKey.startsWith("registry.")) return ["business_validation", "owner_identity"]
    if (sourceKey.startsWith("state_license.")) return ["owner_identity"]
    if (sourceKey === "website" || sourceKey === "regulated.nppes") return ["owner_identity", "owner_phone"]
    return []
}

function selectedValues(value: unknown) {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

async function loadEnabledIcpValueSets() {
    const [industriesResult, locationsResult] = await Promise.all([
        supabaseAdmin.from("leadgen_icp_industries").select("value").eq("enabled", true),
        supabaseAdmin.from("leadgen_icp_locations").select("value").eq("enabled", true),
    ])
    if (industriesResult.error) throw new Error("Could not load supported ICP industries.")
    if (locationsResult.error) throw new Error("Could not load supported ICP locations.")
    return {
        industries: new Set(((industriesResult.data ?? []) as EnabledIcpValueRow[]).map((item) => item.value)),
        locations: new Set(((locationsResult.data ?? []) as EnabledIcpValueRow[]).map((item) => item.value)),
    }
}

function sourceMappedForIcp(sourceKey: LeadgenSourceKey, icpConfig: LeadgenSourceSpecificConfig | undefined, industryMappings: SourceMapping[], locationMappings: SourceMapping[]) {
    const selectedIndustries = selectedValues(icpConfig?.industries)
    const selectedLocations = selectedValues(icpConfig?.locations)
    if (selectedIndustries.length === 0 || selectedLocations.length === 0) return false
    const mappedIndustries = new Set(industryMappings.filter((mapping) => mapping.source_key === sourceKey && (mapping.native_values?.length ?? 0) > 0).map((mapping) => mapping.icp_industry_value).filter(Boolean))
    const mappedLocations = new Set(locationMappings.filter((mapping) => mapping.source_key === sourceKey && (mapping.native_values?.length ?? 0) > 0).map((mapping) => mapping.icp_location_value).filter(Boolean))
    return selectedIndustries.some((value) => mappedIndustries.has(value)) && selectedLocations.some((value) => mappedLocations.has(value))
}

async function reconcileEnabledSourcesForCategoryIntents({
    enabledSources,
    icpConfig,
    sourceCategoryIntents,
}: {
    enabledSources: LeadgenSourceKey[]
    icpConfig: LeadgenSourceSpecificConfig | undefined
    sourceCategoryIntents: Partial<Record<LeadgenSourceCategoryIntentKey, boolean>>
}) {
    if (!Object.values(sourceCategoryIntents).some(Boolean)) return enabledSources
    const [industryMappingsResult, locationMappingsResult, catalogResult] = await Promise.all([
        supabaseAdmin.from("leadgen_source_industry_mappings").select("source_key, icp_industry_value, native_values").eq("enabled", true),
        supabaseAdmin.from("leadgen_source_location_mappings").select("source_key, icp_location_value, native_values").eq("enabled", true),
        supabaseAdmin.from("leadgen_source_catalog").select("source_key, stage_capabilities"),
    ])
    if (industryMappingsResult.error) throw new Error("Could not load source industry mappings.")
    if (locationMappingsResult.error) throw new Error("Could not load source location mappings.")
    if (catalogResult.error) throw new Error("Could not load source stage capabilities.")
    const industryMappings = (industryMappingsResult.data ?? []) as SourceMapping[]
    const locationMappings = (locationMappingsResult.data ?? []) as SourceMapping[]
    const catalogBySource = new Map(((catalogResult.data ?? []) as SourceCatalogStageRow[]).map((source) => [source.source_key, source]))
    const next = new Set(enabledSources)
    for (const source of leadgenSourceOptions) {
        const sourceStages = stageCapabilities(catalogBySource.get(source.value)?.stage_capabilities)
        const effectiveStages = sourceStages.length ? sourceStages : fallbackSourceStages(source.value)
        const categoryIntentApplies = effectiveStages.some((stageKey) => sourceCategoryIntents[sourceCategoryIntentKey(stageKey, source.category)])
        if (!categoryIntentApplies) continue
        const configured = executableLeadgenSources.has(source.value) && leadgenSourceRuntimeConfigured(source.value)
        const mapped = sourceMappedForIcp(source.value, icpConfig, industryMappings, locationMappings)
        if (configured && mapped) next.add(source.value)
        else next.delete(source.value)
    }
    return [...next]
}

export async function updateLeadgenWorkspaceName(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const name = String(formData.get("name") ?? "").trim()
    if (name.length < 2 || name.length > 100) throw new Error("Workspace names must be between 2 and 100 characters.")
    const { error } = await supabaseAdmin.from("workspaces").update({ name }).eq("id", workspace.id)
    if (error) throw new Error("Could not update workspace name.")
    refresh(slug)
}

export async function updateLeadgenCoverLayout(slug: string, bannerHeight: number, bannerPosition: number) {
    const { workspace } = await requireWorkspace(slug, "admin")
    if (!Number.isInteger(bannerHeight) || bannerHeight < 192 || bannerHeight > 288) throw new Error("Banner height must be between 192px and 288px.")
    if (!Number.isInteger(bannerPosition) || bannerPosition < 0 || bannerPosition > 100) throw new Error("Banner position must be between 0 and 100.")
    const { error } = await supabaseAdmin.from("workspaces").update({ leadgen_banner_height: bannerHeight, leadgen_banner_position: bannerPosition }).eq("id", workspace.id)
    if (error) throw new Error("Could not update leadgen cover.")
    refresh(slug)
}

export async function uploadLeadgenBanner(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const file = formData.get("banner")
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload.")
    const bannerPath = await storeWorkspaceImage(workspace.id, { name: file.name, size: file.size, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
    const { error } = await supabaseAdmin.from("workspaces").update({ leadgen_banner_path: bannerPath }).eq("id", workspace.id)
    if (error) throw new Error("The banner uploaded, but could not be saved to leadgen.")
    refresh(slug)
}

export async function uploadSharedWorkspaceLogo(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const file = formData.get("logo")
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload.")
    const logoPath = await storeWorkspaceImage(workspace.id, { name: file.name, size: file.size, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
    const { error } = await supabaseAdmin.from("workspaces").update({ logo_path: logoPath }).eq("id", workspace.id)
    if (error) throw new Error("The logo uploaded, but could not be saved to this workspace.")
    refresh(slug)
}

export async function saveLeadgenSettings(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const settingsResult = await supabaseAdmin
        .from("leadgen_workspace_settings")
        .select("poll_interval_hours, automatic_polls_enabled, geography, enabled_sources, source_config")
        .eq("workspace_id", workspace.id)
        .maybeSingle()
    const existingSettings = settingsResult.error ? null : settingsResult.data
    const existingSourceConfig = existingSettings?.source_config && typeof existingSettings.source_config === "object"
        ? existingSettings.source_config as Partial<LeadgenSourceConfig>
        : {}
    const scope = String(formData.get("settingsScope") ?? "all")
    const savingSources = scope === "sources" || scope === "all"
    const savingSettings = scope === "settings" || scope === "all"
    const submittedEnabledSources = savingSources ? [...new Set(formData.getAll("sources")
        .map((value) => normaliseLeadgenSourceKey(String(value)))
        .filter((value): value is NonNullable<typeof value> => Boolean(value)))] : Array.isArray(existingSettings?.enabled_sources)
            ? existingSettings.enabled_sources.map(String).map(normaliseLeadgenSourceKey).filter((value): value is NonNullable<typeof value> => Boolean(value))
            : []
    const sourceCategoryIntents = savingSources ? submittedSourceCategoryIntents(formData) : normaliseSourceCategoryIntents(existingSourceConfig.sourceCategoryIntents)
    const enabledIcpValues = await loadEnabledIcpValueSets()
    const nextIcpConfig = savingSettings ? {
        industries: formData.getAll("sourceConfig:icp:industries").map((value) => String(value)).filter((value) => enabledIcpValues.industries.has(value)),
        locations: formData.getAll("sourceConfig:icp:locations").map((value) => String(value)).filter((value) => enabledIcpValues.locations.has(value)),
        limit: boundedInteger(formData.get("sourceConfig:icp:limit"), 1000, 10, 5000),
        maxEnrichmentDepth: boundedInteger(formData.get("sourceConfig:icp:maxEnrichmentDepth"), 4, 1, 8),
        ownerRequired: formData.get("sourceConfig:icp:ownerRequired") !== "off",
    } : existingSourceConfig.icp ? {
        ...existingSourceConfig.icp,
        industries: selectedValues(existingSourceConfig.icp.industries).filter((value) => enabledIcpValues.industries.has(value)),
        locations: selectedValues(existingSourceConfig.icp.locations).filter((value) => enabledIcpValues.locations.has(value)),
    } : undefined
    const enabledSources = await reconcileEnabledSourcesForCategoryIntents({
        enabledSources: submittedEnabledSources,
        icpConfig: nextIcpConfig,
        sourceCategoryIntents,
    })
    const sourceConfig = leadgenSourceOptions.reduce<LeadgenSourceConfig>((config, source) => {
        if (!savingSources) {
            config[source.value] = existingSourceConfig[source.value] ?? {}
            return config
        }
        const limit = Number(formData.get(`sourceConfig:${source.value}:limit`) ?? 10)
        const radiusMeters = Number(formData.get(`sourceConfig:${source.value}:radiusMeters`) ?? 24000)
        const crawlDepth = Number(formData.get(`sourceConfig:${source.value}:crawlDepth`) ?? 2)
        const timeoutSeconds = Number(formData.get(`sourceConfig:${source.value}:timeoutSeconds`) ?? 10)
        const release = String(formData.get(`sourceConfig:${source.value}:release`) ?? "").trim()
        const notes = String(formData.get(`sourceConfig:${source.value}:notes`) ?? "").trim()
        config[source.value] = {
            enabled: enabledSources.includes(source.value),
            limit: Number.isFinite(limit) ? Math.min(sourceLimitMax(source.value, source.kind), Math.max(1, Math.floor(limit))) : 10,
            radiusMeters: Number.isFinite(radiusMeters) ? Math.min(40000, Math.max(1000, Math.floor(radiusMeters))) : 24000,
            crawlDepth: Number.isFinite(crawlDepth) ? Math.min(5, Math.max(1, Math.floor(crawlDepth))) : 2,
            timeoutSeconds: Number.isFinite(timeoutSeconds) ? Math.min(30, Math.max(3, Math.floor(timeoutSeconds))) : 10,
            respectRobots: formData.get(`sourceConfig:${source.value}:respectRobots`) !== "off",
            release,
            notes,
        }
        return config
    }, {
        icp: nextIcpConfig,
        sourceCategoryIntents,
    })
    const pollIntervalHours = savingSettings ? Number(formData.get("pollIntervalHours") ?? 168) : existingSettings?.poll_interval_hours ?? 168
    if (!Number.isInteger(pollIntervalHours) || pollIntervalHours < 1 || pollIntervalHours > 2160) throw new Error("Poll interval must be between 1 and 2160 hours.")
    const { error } = await supabaseAdmin.from("leadgen_workspace_settings").upsert({
        workspace_id: workspace.id,
        poll_interval_hours: pollIntervalHours,
        automatic_polls_enabled: savingSettings ? formData.get("automaticPollsEnabled") === "on" : Boolean(existingSettings?.automatic_polls_enabled),
        geography: savingSettings ? String(formData.get("geography") ?? "").trim() || null : existingSettings?.geography ?? null,
        icp_notes: null,
        enabled_sources: enabledSources,
        source_config: sourceConfig,
    })
    if (error) throw new Error("Could not save leadgen settings.")
    refresh(slug)
}
