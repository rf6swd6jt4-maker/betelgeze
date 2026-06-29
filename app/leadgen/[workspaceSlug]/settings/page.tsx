import { WorkspaceIdentityEditor } from "@/components/admin/WorkspaceIdentityEditor"
import { AutoSaveSettingsForm } from "@/components/leadgen/AutoSaveSettingsForm"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { SearchableMultiSelect } from "@/components/leadgen/SearchableMultiSelect"
import { SourceSettingsCard, type SourceCatalogueStats, type SourceSettingsItem } from "@/components/leadgen/SourceSettingsCard"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import type { LeadgenSourceCatalogRow } from "@/lib/leadgen/source-catalog-ui"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { executableLeadgenSources, leadgenSourceOptions, type LeadgenSourceConfig, type LeadgenSourceKey } from "@/lib/leadgen/sources"
import { saveLeadgenSettings, updateLeadgenCoverLayout, updateLeadgenWorkspaceName, uploadLeadgenBanner, uploadSharedWorkspaceLogo } from "./actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }
type IcpOption = { value: string; label: string; category?: string | null; location_kind?: string | null; region?: string | null; locality?: string | null }
type SourceMapping = { source_key: LeadgenSourceKey; icp_industry_value?: string | null; icp_location_value?: string | null; native_values?: string[] | null }

function sourceConfigValue(config: unknown): Partial<LeadgenSourceConfig> {
    return config && typeof config === "object" ? config as Partial<LeadgenSourceConfig> : {}
}

export default async function LeadgenSettingsPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const [bannerSrc, logoSrc] = await Promise.all([
        workspace.leadgen_banner_path ? createUploadSignedUrl(workspace.leadgen_banner_path) : null,
        workspace.logo_path ? createUploadSignedUrl(workspace.logo_path) : null,
    ])
    const [settingsResult, industriesResult, locationsResult, industryMappingsResult, locationMappingsResult, catalogResult] = await Promise.all([
        supabaseAdmin
        .from("leadgen_workspace_settings")
        .select("poll_interval_hours, automatic_polls_enabled, geography, icp_notes, enabled_sources, source_config")
        .eq("workspace_id", workspace.id)
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
            .select("source_key, label, family, source_points, owner_identity_points, owner_phone_points, business_support_points, access_method, free_status, implementation_status, run_stage, enabled, rate_limit_ms, coverage, metadata")
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
    const activeCatalogSources = catalog.filter((source) => source.enabled && source.implementation_status === "active")
    const validationOnlyCount = catalog.filter((source) => source.implementation_status === "validation_only").length
    const needsWorkCount = catalog.filter((source) => ["source_specific_configuration", "bulk_refresh"].includes(source.run_stage ?? "")).length
    const blockedCount = catalog.filter((source) => source.implementation_status === "blocked" || source.run_stage === "blocked").length
    const catalogueStats: SourceCatalogueStats = {
        active: activeCatalogSources.length,
        validationOnly: validationOnlyCount,
        needsWork: needsWorkCount,
        blocked: blockedCount,
    }

    const industryLabelByValue = new Map(icpIndustries.map((industry) => [industry.value, industry.label]))
    const locationLabelByValue = new Map(icpLocations.map((location) => [location.value, location.label]))
    const sourceLabelByValue = new Map<string, string>(leadgenSourceOptions.map((source) => [source.value, source.label]))

    function labelsFor(values: string[], labels: Map<string, string>) {
        return values.map((value) => labels.get(value) ?? value).filter(Boolean)
    }

    function compactSourceList(values: string[]) {
        if (values.length === 0) return "No source mappings yet"
        if (values.length <= 3) return `Maps to ${values.join(", ")}`
        return `Maps to ${values.slice(0, 3).join(", ")} +${values.length - 3} more`
    }

    function sourcesForIndustry(industryValue: string) {
        const labels = [...new Set(industryMappings
            .filter((mapping) => mapping.icp_industry_value === industryValue && (mapping.native_values?.length ?? 0) > 0)
            .map((mapping) => sourceLabelByValue.get(mapping.source_key) ?? mapping.source_key))]
        return compactSourceList(labels)
    }

    function sourcesForLocation(locationValue: string) {
        const labels = [...new Set(locationMappings
            .filter((mapping) => mapping.icp_location_value === locationValue && (mapping.native_values?.length ?? 0) > 0)
            .map((mapping) => sourceLabelByValue.get(mapping.source_key) ?? mapping.source_key))]
        return compactSourceList(labels)
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
        let reason = "Choose ICP industries and locations to see whether this source can run."
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
                description="Leadgen settings for this workspace."
                bannerLabel="leadgen banner"
            />
            <LeadgenTabs workspaceSlug={workspace.slug} active="settings" />
            <AutoSaveSettingsForm action={saveLeadgenSettings.bind(null, workspace.slug)}>
                <section className="grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
                    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                    <h2 className="text-lg font-semibold">Poll options</h2>
                        <p className="mt-2 text-sm leading-6 text-neutral-400">Cadence and manual test runs.</p>
                        <div className="mt-5 grid gap-4">
                        <label className="block text-sm text-neutral-300">Automatic poll interval<input name="pollIntervalHours" type="number" min={1} max={2160} defaultValue={settings?.poll_interval_hours ?? 168} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /><span className="mt-1 block text-xs text-neutral-500">Hours between scheduled polls. 168 = weekly.</span></label>
                        <label className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-300"><input name="automaticPollsEnabled" type="checkbox" defaultChecked={Boolean(settings?.automatic_polls_enabled)} className="h-4 w-4 accent-white" />Run polls automatically on this cadence</label>
                        </div>
                    </div>
                    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                        <h2 className="text-lg font-semibold">ICP targeting</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Shared target categories for sources that use the same broad Betelgeze ICP taxonomy, such as GBP, directories, and business registries.</p>
                        <div className="mt-5 grid gap-4 md:grid-cols-2">
                            <SearchableMultiSelect name="sourceConfig:icp:locations" label="Target locations" options={icpLocations.map((target) => ({ value: target.value, label: target.label, detail: `${target.location_kind ?? "location"}${target.region ? ` / ${target.region}` : ""}. ${sourcesForLocation(target.value)}` }))} selectedValues={selectedLocations} />
                            <SearchableMultiSelect name="sourceConfig:icp:industries" label="Target industries" options={icpIndustries.map((industry) => ({ value: industry.value, label: industry.label, detail: `${industry.category ?? "industry"}. ${sourcesForIndustry(industry.value)}` }))} selectedValues={selectedIndustries} />
                            <label className="block text-sm text-neutral-300">Candidate target count<input name="sourceConfig:icp:limit" type="number" min={10} max={5000} defaultValue={sourceConfig.icp?.limit ?? 1000} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /><span className="mt-1 block text-xs text-neutral-500">Upper bound for seed candidates before enrichment and qualification.</span></label>
                            <label className="block text-sm text-neutral-300">Max enrichment depth<input name="sourceConfig:icp:maxEnrichmentDepth" type="number" min={1} max={8} defaultValue={sourceConfig.icp?.maxEnrichmentDepth ?? 4} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /><span className="mt-1 block text-xs text-neutral-500">How far the pipeline may chase owner/phone evidence across supporting sources.</span></label>
                            <label className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-300 md:col-span-2"><input name="sourceConfig:icp:ownerRequired" type="checkbox" defaultChecked={sourceConfig.icp?.ownerRequired !== false} className="h-4 w-4 accent-white" />Only show qualified leads when owner/principal and phone evidence is found</label>
                            <label className="block text-sm text-neutral-300 md:col-span-2">ICP notes<textarea name="icpNotes" defaultValue={settings?.icp_notes ?? ""} rows={3} placeholder="Company size, services, revenue band, licensing requirements, review profile, and disqualifiers." className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /></label>
                            <input type="hidden" name="geography" value={settings?.geography ?? ""} />
                        </div>
                    </div>
                </section>
                <SourceSettingsCard sources={sourceItems} catalogueStats={catalogueStats} />
                <button className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Save now</button>
            </AutoSaveSettingsForm>
            <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
        </div>
    </main>
}
