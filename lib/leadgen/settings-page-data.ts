import type { AdaptiveIndustryOption, AdaptiveLocationOption } from "@/components/leadgen/AdaptiveTargetingSettings"
import type { SourceCatalogueStats, SourceSettingsItem } from "@/components/leadgen/SourceSettingsCard"
import type { LeadgenSourceCatalogRow } from "@/lib/leadgen/source-catalog-ui"
import {
    executableLeadgenSources,
    leadgenSourceEnvVars,
    leadgenSourceOptions,
    leadgenSourceRuntimeConfigured,
    type LeadgenSourceCategoryIntentKey,
    type LeadgenSourceCategoryKey,
    type LeadgenSourceConfig,
    type LeadgenSourceKey,
    type LeadgenSourceStageKey,
} from "@/lib/leadgen/sources"
import { supabaseAdmin } from "@/lib/supabase/admin"

type IcpOption = {
    value: string
    label: string
    category?: string | null
    location_kind?: string | null
    region?: string | null
    locality?: string | null
}
type SourceMapping = {
    source_key: LeadgenSourceKey
    icp_industry_value?: string | null
    icp_location_value?: string | null
    native_values?: string[] | null
}
type CatalogSource = {
    source_key: string
    family: string | null
    implementation_status: string | null
    enabled: boolean | null
}
type SourceStageKey = LeadgenSourceStageKey

export function sourceConfigValue(config: unknown): Partial<LeadgenSourceConfig> {
    return config && typeof config === "object" ? config as Partial<LeadgenSourceConfig> : {}
}

function stageCapabilities(value: unknown) {
    if (!Array.isArray(value)) return [] as SourceStageKey[]
    return value
        .map((item) => item && typeof item === "object" && "stage_key" in item ? String(item.stage_key) : null)
        .filter((item): item is SourceStageKey => item === "business_validation" || item === "owner_identity" || item === "owner_phone" || item === "phone_validation")
}

function primarySourceStage(sourceKey: LeadgenSourceKey, stages: SourceStageKey[]) {
    if (stages.includes("phone_validation")) return "phone_validation"
    if (stages.includes("owner_phone")) return "owner_phone"
    if (stages.includes("owner_identity")) return "owner_identity"
    if (sourceKey === "transport.fmcsa_safer" && stages.includes("business_validation")) return "business_validation"
    if (sourceKey.startsWith("permits.") && stages.includes("business_validation")) return "business_validation"
    if (sourceKey === "regulated.epa_echo" && stages.includes("business_validation")) return "business_validation"
    return stages[0] ?? null
}

function sourceCategoryIntentKey(stageKey: SourceStageKey, category: LeadgenSourceCategoryKey) {
    return `${stageKey}:${category}` as const
}

function fallbackSourceStages(sourceKey: LeadgenSourceKey): SourceStageKey[] {
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

function compactSourceList(values: string[]) {
    if (values.length === 0) return "No source mappings yet"
    if (values.length <= 3) return `Maps to ${values.join(", ")}`
    return `Maps to ${values.slice(0, 3).join(", ")} +${values.length - 3} more`
}

function labelsFor(values: string[], labels: Map<string, string>) {
    return values.map((value) => labels.get(value) ?? value).filter(Boolean)
}

export async function loadLeadgenSettingsPageData(workspaceId: string) {
    const [
        settingsResult,
        industriesResult,
        locationsResult,
        industryMappingsResult,
        locationMappingsResult,
        activeCatalogResult,
        fullCatalogResult,
    ] = await Promise.all([
        supabaseAdmin
            .from("leadgen_workspace_settings")
            .select("poll_interval_hours, automatic_polls_enabled, geography, enabled_sources, source_config")
            .eq("workspace_id", workspaceId)
            .maybeSingle(),
        supabaseAdmin
            .from("leadgen_icp_industries")
            .select("value, label, category")
            .eq("enabled", true)
            .order("label", { ascending: true }),
        supabaseAdmin
            .from("leadgen_icp_locations")
            .select("value, label, location_kind, region, locality")
            .eq("enabled", true)
            .order("label", { ascending: true }),
        supabaseAdmin
            .from("leadgen_source_industry_mappings")
            .select("source_key, icp_industry_value, native_values")
            .eq("enabled", true),
        supabaseAdmin
            .from("leadgen_source_location_mappings")
            .select("source_key, icp_location_value, native_values")
            .eq("enabled", true),
        supabaseAdmin
            .from("leadgen_source_catalog")
            .select("source_key, family, implementation_status, enabled")
            .eq("enabled", true),
        supabaseAdmin
            .from("leadgen_source_catalog")
            .select("source_key, label, family, source_points, owner_identity_points, owner_phone_points, business_support_points, access_method, free_status, implementation_status, run_stage, stage_capabilities, enabled, rate_limit_ms, coverage, metadata")
            .order("family", { ascending: true })
            .order("label", { ascending: true }),
    ])

    const settings = settingsResult.error ? null : settingsResult.data
    const sourceConfig = sourceConfigValue(settings?.source_config)
    const icpIndustries = (industriesResult.error ? [] : industriesResult.data ?? []) as IcpOption[]
    const icpLocations = (locationsResult.error ? [] : locationsResult.data ?? []) as IcpOption[]
    const industryMappings = (industryMappingsResult.error ? [] : industryMappingsResult.data ?? []) as SourceMapping[]
    const locationMappings = (locationMappingsResult.error ? [] : locationMappingsResult.data ?? []) as SourceMapping[]
    const activeCatalog = (activeCatalogResult.error ? [] : activeCatalogResult.data ?? []) as CatalogSource[]
    const fullCatalog = (fullCatalogResult.error ? [] : fullCatalogResult.data ?? []) as LeadgenSourceCatalogRow[]

    const sourceLabelByValue = new Map<string, string>(leadgenSourceOptions.map((source) => [source.value, source.label]))
    const industryByValue = new Map(icpIndustries.map((industry) => [industry.value, industry]))
    const locationByValue = new Map(icpLocations.map((location) => [location.value, location]))
    const industryLabelByValue = new Map(icpIndustries.map((industry) => [industry.value, industry.label]))
    const locationLabelByValue = new Map(icpLocations.map((location) => [location.value, location.label]))
    const selectedIndustries = (Array.isArray(sourceConfig.icp?.industries) ? sourceConfig.icp.industries : []).filter((value) => industryByValue.has(value))
    const selectedLocations = (Array.isArray(sourceConfig.icp?.locations) ? sourceConfig.icp.locations : []).filter((value) => locationByValue.has(value))
    const adaptiveSourceKeys = new Set(activeCatalog
        .filter((source) => source.enabled && source.implementation_status === "active")
        .filter((source) => ["licensing", "permits", "registries", "transport", "regulated", "procurement", "safety"].includes(source.family ?? ""))
        .map((source) => source.source_key))

    function adaptiveCoverageForIndustry(industryValue: string) {
        const supportingSourceKeys = [...new Set(industryMappings
            .filter((mapping) => mapping.icp_industry_value === industryValue && (mapping.native_values?.length ?? 0) > 0 && adaptiveSourceKeys.has(mapping.source_key))
            .map((mapping) => mapping.source_key))]
        const supportedLocationValues = [...new Set(locationMappings
            .filter((mapping) => supportingSourceKeys.includes(mapping.source_key) && (mapping.native_values?.length ?? 0) > 0)
            .map((mapping) => mapping.icp_location_value)
            .filter((value): value is string => Boolean(value)))]
        const supportedRegions = [...new Set(supportedLocationValues
            .map((value) => locationByValue.get(value)?.region)
            .filter((value): value is string => Boolean(value))
            .map((value) => value.toUpperCase()))]
        const sourceLabels = supportingSourceKeys.map((sourceKey) => sourceLabelByValue.get(sourceKey) ?? sourceKey)
        return {
            detail: compactSourceList(sourceLabels),
            supportedRegions,
            supportedLocationValues,
        }
    }

    function sourcesForLocation(locationValue: string) {
        const labels = [...new Set(locationMappings
            .filter((mapping) => mapping.icp_location_value === locationValue && (mapping.native_values?.length ?? 0) > 0)
            .map((mapping) => sourceLabelByValue.get(mapping.source_key) ?? mapping.source_key))]
        return compactSourceList(labels)
    }

    const adaptiveIndustries: AdaptiveIndustryOption[] = icpIndustries.map((industry) => {
        const coverage = adaptiveCoverageForIndustry(industry.value)
        return {
            value: industry.value,
            label: industry.label,
            category: industry.category,
            detail: coverage.detail,
            supportedRegions: coverage.supportedRegions,
            supportedLocationValues: coverage.supportedLocationValues,
        }
    })
    const adaptiveLocations: AdaptiveLocationOption[] = icpLocations.map((target) => ({
        value: target.value,
        label: target.label,
        region: target.region,
        detail: `${target.location_kind ?? "location"}${target.region ? ` / ${target.region}` : ""}. ${sourcesForLocation(target.value)}`,
    }))

    const enabledSources = new Set(Array.isArray(settings?.enabled_sources) ? settings.enabled_sources.map(String) : [])
    const catalogueStats: SourceCatalogueStats = {
        active: fullCatalog.filter((source) => source.enabled && source.implementation_status === "active").length,
        validationOnly: fullCatalog.filter((source) => source.implementation_status === "validation_only").length,
        needsWork: fullCatalog.filter((source) => ["source_specific_configuration", "bulk_refresh"].includes(source.run_stage ?? "")).length,
        blocked: fullCatalog.filter((source) => source.implementation_status === "blocked" || source.run_stage === "blocked").length,
    }
    const catalogBySource = new Map(fullCatalog.map((source) => [source.source_key, source]))

    function mappingSummary(sourceKey: LeadgenSourceKey) {
        const mappedIndustryValues = [...new Set(industryMappings.filter((mapping) => mapping.source_key === sourceKey && (mapping.native_values?.length ?? 0) > 0).map((mapping) => mapping.icp_industry_value).filter((value): value is string => Boolean(value)))]
        const mappedLocationValues = [...new Set(locationMappings.filter((mapping) => mapping.source_key === sourceKey && (mapping.native_values?.length ?? 0) > 0).map((mapping) => mapping.icp_location_value).filter((value): value is string => Boolean(value)))]
        const mappedIndustries = new Set(mappedIndustryValues)
        const mappedLocations = new Set(mappedLocationValues)
        const selectedMappedIndustries = selectedIndustries.filter((value) => mappedIndustries.has(value))
        const selectedMappedLocations = selectedLocations.filter((value) => mappedLocations.has(value))
        const selectedUnmappedIndustries = selectedIndustries.filter((value) => !mappedIndustries.has(value))
        const selectedUnmappedLocations = selectedLocations.filter((value) => !mappedLocations.has(value))
        const selectedIndustryCount = selectedIndustries.length
        const selectedLocationCount = selectedLocations.length
        const coveredIndustryCount = selectedMappedIndustries.length
        const coveredLocationCount = selectedMappedLocations.length
        const ready = selectedIndustryCount > 0 && selectedLocationCount > 0 && coveredIndustryCount > 0 && coveredLocationCount > 0
        let reason = "Choose ICP industries and locations in Settings to see whether this source can run."
        if (selectedIndustryCount > 0 && selectedLocationCount > 0 && ready) reason = `Runs for ${coveredIndustryCount} selected industry${coveredIndustryCount === 1 ? "" : "ies"} and ${coveredLocationCount} selected location${coveredLocationCount === 1 ? "" : "s"}.`
        else if (selectedIndustryCount > 0 && selectedLocationCount > 0 && coveredIndustryCount === 0 && coveredLocationCount === 0) reason = "None of the selected industries or locations map to this source."
        else if (selectedIndustryCount > 0 && selectedLocationCount > 0 && coveredIndustryCount === 0) reason = "The selected locations are supported, but the selected industries are not mapped to this source."
        else if (selectedIndustryCount > 0 && selectedLocationCount > 0 && coveredLocationCount === 0) reason = "The selected industries are supported, but the selected locations are not mapped to this source."
        return {
            industryText: selectedIndustryCount ? `${coveredIndustryCount}/${selectedIndustryCount} selected industries` : "Choose ICP industries",
            locationText: selectedLocationCount ? `${coveredLocationCount}/${selectedLocationCount} selected locations` : "Choose ICP locations",
            ready,
            reason,
            selectedMappedIndustryLabels: labelsFor(selectedMappedIndustries, industryLabelByValue),
            selectedUnmappedIndustryLabels: labelsFor(selectedUnmappedIndustries, industryLabelByValue),
            selectedMappedLocationLabels: labelsFor(selectedMappedLocations, locationLabelByValue),
            selectedUnmappedLocationLabels: labelsFor(selectedUnmappedLocations, locationLabelByValue),
            allMappedIndustryLabels: labelsFor(mappedIndustryValues, industryLabelByValue),
            allMappedLocationLabels: labelsFor(mappedLocationValues, locationLabelByValue),
        }
    }

    const sourceCategoryIntents = sourceConfig.sourceCategoryIntents && typeof sourceConfig.sourceCategoryIntents === "object" ? sourceConfig.sourceCategoryIntents : {}
    const sourceItems: SourceSettingsItem[] = leadgenSourceOptions.map((source) => {
        const implemented = executableLeadgenSources.has(source.value)
        const sourceSettings = sourceConfig[source.value]
        const mapped = mappingSummary(source.value)
        const stageKeys = stageCapabilities(catalogBySource.get(source.value)?.stage_capabilities)
        const effectiveStageKeys = stageKeys.length ? stageKeys : fallbackSourceStages(source.value)
        const sourceStage = primarySourceStage(source.value, effectiveStageKeys)
        const envVars = leadgenSourceEnvVars(source)
        const apiKeyConfigured = leadgenSourceRuntimeConfigured(source.value)
        const configured = implemented && apiKeyConfigured
        const categoryIntentEnabled = effectiveStageKeys.some((stageKey) => sourceCategoryIntents[sourceCategoryIntentKey(stageKey, source.category)])
        const enabled = configured && mapped.ready && (enabledSources.has(source.value) || categoryIntentEnabled)
        return {
            value: source.value,
            label: source.label,
            detail: source.detail,
            statusLabel: source.statusLabel,
            notesPlaceholder: source.notesPlaceholder,
            kind: source.kind,
            category: source.category,
            sourceStage,
            stageKeys: effectiveStageKeys,
            configured,
            mapped: mapped.ready,
            enabled,
            implemented,
            apiKeyConfigured,
            envVar: source.envVar ?? null,
            envVars,
            setupHint: source.setupHint ?? null,
            mappingIndustryText: mapped.industryText,
            mappingLocationText: mapped.locationText,
            mappingReason: mapped.reason,
            selectedMappedIndustryLabels: mapped.selectedMappedIndustryLabels,
            selectedUnmappedIndustryLabels: mapped.selectedUnmappedIndustryLabels,
            selectedMappedLocationLabels: mapped.selectedMappedLocationLabels,
            selectedUnmappedLocationLabels: mapped.selectedUnmappedLocationLabels,
            allMappedIndustryLabels: mapped.allMappedIndustryLabels,
            allMappedLocationLabels: mapped.allMappedLocationLabels,
            settings: {
                limit: sourceSettings?.limit ?? (source.value === "overture" ? 100 : source.value === "sam_gov" ? 1 : source.kind === "seed" ? 10 : 25),
                radiusMeters: sourceSettings?.radiusMeters ?? 24000,
                crawlDepth: sourceSettings?.crawlDepth ?? 2,
                timeoutSeconds: sourceSettings?.timeoutSeconds ?? 10,
                respectRobots: sourceSettings?.respectRobots !== false,
                release: sourceSettings?.release ?? (source.value === "alltheplaces" ? "latest" : "2026-06-17.0"),
                notes: sourceSettings?.notes ?? "",
            },
        }
    })

    return {
        settings,
        sourceConfig,
        selectedIndustries,
        selectedLocations,
        adaptiveIndustries,
        adaptiveLocations,
        sourceItems,
        sourceCategoryIntents: sourceCategoryIntents as Partial<Record<LeadgenSourceCategoryIntentKey, boolean>>,
        catalogueStats,
    }
}
