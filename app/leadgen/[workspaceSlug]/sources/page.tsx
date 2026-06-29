import { WorkspaceIdentityEditor } from "@/components/admin/WorkspaceIdentityEditor"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { ManualSettingsForm } from "@/components/leadgen/ManualSettingsForm"
import { SourceSettingsCard, type SourceCatalogueStats, type SourceSettingsItem } from "@/components/leadgen/SourceSettingsCard"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import type { LeadgenSourceCatalogRow } from "@/lib/leadgen/source-catalog-ui"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { executableLeadgenSources, leadgenSourceOptions, type LeadgenSourceConfig, type LeadgenSourceKey } from "@/lib/leadgen/sources"
import { saveLeadgenSettings, updateLeadgenCoverLayout, updateLeadgenWorkspaceName, uploadLeadgenBanner, uploadSharedWorkspaceLogo } from "../settings/actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }
type IcpOption = { value: string; label: string }
type SourceMapping = { source_key: LeadgenSourceKey; icp_industry_value?: string | null; icp_location_value?: string | null; native_values?: string[] | null }
type SourceStageKey = "business_validation" | "owner_identity" | "owner_phone" | "phone_validation"

function sourceConfigValue(config: unknown): Partial<LeadgenSourceConfig> {
    return config && typeof config === "object" ? config as Partial<LeadgenSourceConfig> : {}
}

function stageCapabilities(value: unknown) {
    if (!Array.isArray(value)) return [] as SourceStageKey[]
    return value
        .map((item) => item && typeof item === "object" && "stage_key" in item ? String(item.stage_key) : null)
        .filter((item): item is SourceStageKey => item === "business_validation" || item === "owner_identity" || item === "owner_phone" || item === "phone_validation")
}

function primarySourceStage(sourceKey: LeadgenSourceKey, stages: SourceStageKey[]) {
    if (sourceKey === "sam_gov") return null
    if (sourceKey === "transport.fmcsa_safer" && stages.includes("business_validation")) return "business_validation"
    if (sourceKey.startsWith("state_license.") && stages.includes("owner_identity")) return "owner_identity"
    if (sourceKey === "website" && stages.includes("owner_identity")) return "owner_identity"
    if (sourceKey === "regulated.nppes" && stages.includes("owner_identity")) return "owner_identity"
    return stages[0] ?? null
}

function fallbackSourceStages(sourceKey: LeadgenSourceKey): SourceStageKey[] {
    if (sourceKey === "transport.fmcsa_safer") return ["business_validation"]
    if (sourceKey.startsWith("state_license.") || sourceKey === "website" || sourceKey === "regulated.nppes") return ["owner_identity"]
    return []
}

export default async function LeadgenSourcesPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const [bannerSrc, logoSrc] = await Promise.all([
        workspace.leadgen_banner_path ? createUploadSignedUrl(workspace.leadgen_banner_path) : null,
        workspace.logo_path ? createUploadSignedUrl(workspace.logo_path) : null,
    ])
    const [settingsResult, industriesResult, locationsResult, industryMappingsResult, locationMappingsResult, catalogResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_workspace_settings")
            .select("enabled_sources, source_config")
            .eq("workspace_id", workspace.id)
            .maybeSingle(),
        supabaseAdmin
            .from("leadgen_icp_industries")
            .select("value, label")
            .eq("enabled", true)
            .order("label", { ascending: true }),
        supabaseAdmin
            .from("leadgen_icp_locations")
            .select("value, label")
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
            .select("source_key, label, family, source_points, owner_identity_points, owner_phone_points, business_support_points, access_method, free_status, implementation_status, run_stage, stage_capabilities, enabled, rate_limit_ms, coverage, metadata")
            .order("family", { ascending: true })
            .order("label", { ascending: true }),
    ])
    const settings = settingsResult.error ? null : settingsResult.data
    const enabledSources = new Set(Array.isArray(settings?.enabled_sources) ? settings.enabled_sources.map(String) : [])
    const sourceConfig = sourceConfigValue(settings?.source_config)
    const icpIndustries = (industriesResult.error ? [] : industriesResult.data ?? []) as IcpOption[]
    const icpLocations = (locationsResult.error ? [] : locationsResult.data ?? []) as IcpOption[]
    const industryMappings = (industryMappingsResult.error ? [] : industryMappingsResult.data ?? []) as SourceMapping[]
    const locationMappings = (locationMappingsResult.error ? [] : locationMappingsResult.data ?? []) as SourceMapping[]
    const catalog = (catalogResult.error ? [] : catalogResult.data ?? []) as LeadgenSourceCatalogRow[]
    const selectedIndustries = Array.isArray(sourceConfig.icp?.industries) ? sourceConfig.icp.industries : []
    const selectedLocations = Array.isArray(sourceConfig.icp?.locations) ? sourceConfig.icp.locations : []
    const catalogueStats: SourceCatalogueStats = {
        active: catalog.filter((source) => source.enabled && source.implementation_status === "active").length,
        validationOnly: catalog.filter((source) => source.implementation_status === "validation_only").length,
        needsWork: catalog.filter((source) => ["source_specific_configuration", "bulk_refresh"].includes(source.run_stage ?? "")).length,
        blocked: catalog.filter((source) => source.implementation_status === "blocked" || source.run_stage === "blocked").length,
    }

    const industryLabelByValue = new Map(icpIndustries.map((industry) => [industry.value, industry.label]))
    const locationLabelByValue = new Map(icpLocations.map((location) => [location.value, location.label]))
    const catalogBySource = new Map(catalog.map((source) => [source.source_key, source]))

    function labelsFor(values: string[], labels: Map<string, string>) {
        return values.map((value) => labels.get(value) ?? value).filter(Boolean)
    }

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

    const sourceItems: SourceSettingsItem[] = leadgenSourceOptions.map((source) => {
        const implemented = executableLeadgenSources.has(source.value)
        const sourceSettings = sourceConfig[source.value]
        const mapped = mappingSummary(source.value)
        const stageKeys = stageCapabilities(catalogBySource.get(source.value)?.stage_capabilities)
        const effectiveStageKeys = stageKeys.length ? stageKeys : fallbackSourceStages(source.value)
        const sourceStage = primarySourceStage(source.value, effectiveStageKeys)
        const apiKeyConfigured = source.envVar ? Boolean(process.env[source.envVar]) : true
        const configured = implemented && apiKeyConfigured
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
            enabled: configured && mapped.ready && enabledSources.has(source.value),
            implemented,
            apiKeyConfigured,
            envVar: source.envVar ?? null,
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

    return <main className="min-h-screen bg-neutral-950 px-4 py-5 text-white sm:px-6 sm:py-6">
        <div className="mx-auto max-w-7xl">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
            <WorkspaceIdentityEditor
                workspace={{ name: workspace.name, slug: workspace.slug, bannerHeight: workspace.leadgen_banner_height, bannerPosition: workspace.leadgen_banner_position, bannerSrc, logoSrc }}
                updateName={updateLeadgenWorkspaceName.bind(null, workspace.slug)}
                updateCoverLayout={updateLeadgenCoverLayout.bind(null, workspace.slug)}
                uploadBanner={uploadLeadgenBanner.bind(null, workspace.slug)}
                uploadLogo={uploadSharedWorkspaceLogo.bind(null, workspace.slug)}
                product="leadgen"
                description="Leadgen source readiness, mappings, and run controls."
                bannerLabel="leadgen banner"
                editable={false}
            />
            <LeadgenTabs workspaceSlug={workspace.slug} active="sources" />
            <ManualSettingsForm action={saveLeadgenSettings.bind(null, workspace.slug)}>
                <input type="hidden" name="settingsScope" value="sources" />
                <SourceSettingsCard sources={sourceItems} catalogueStats={catalogueStats} />
            </ManualSettingsForm>
            <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
        </div>
    </main>
}
