import { WorkspaceIdentityEditor } from "@/components/admin/WorkspaceIdentityEditor"
import { AdaptiveTargetingSettings, type AdaptiveIndustryOption, type AdaptiveLocationOption } from "@/components/leadgen/AdaptiveTargetingSettings"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { ManualSettingsForm, SettingsSectionActions } from "@/components/leadgen/ManualSettingsForm"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { leadgenSourceOptions, type LeadgenSourceConfig, type LeadgenSourceKey } from "@/lib/leadgen/sources"
import { saveLeadgenSettings, updateLeadgenCoverLayout, updateLeadgenWorkspaceName, uploadLeadgenBanner, uploadSharedWorkspaceLogo } from "./actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }
type IcpOption = { value: string; label: string; category?: string | null; location_kind?: string | null; region?: string | null; locality?: string | null }
type SourceMapping = { source_key: LeadgenSourceKey; icp_industry_value?: string | null; icp_location_value?: string | null; native_values?: string[] | null }
type CatalogSource = { source_key: string; family: string | null; implementation_status: string | null; enabled: boolean | null }

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
        .select("poll_interval_hours, automatic_polls_enabled, geography, enabled_sources, source_config")
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
            .select("source_key, family, implementation_status, enabled")
            .eq("enabled", true),
    ])
    const settings = settingsResult.error ? null : settingsResult.data
    const sourceConfig = sourceConfigValue(settings?.source_config)
    const icpIndustries = (industriesResult.error ? [] : industriesResult.data ?? []) as IcpOption[]
    const icpLocations = (locationsResult.error ? [] : locationsResult.data ?? []) as IcpOption[]
    const industryMappings = (industryMappingsResult.error ? [] : industryMappingsResult.data ?? []) as SourceMapping[]
    const locationMappings = (locationMappingsResult.error ? [] : locationMappingsResult.data ?? []) as SourceMapping[]
    const catalog = (catalogResult.error ? [] : catalogResult.data ?? []) as CatalogSource[]

    const sourceLabelByValue = new Map<string, string>(leadgenSourceOptions.map((source) => [source.value, source.label]))
    const industryByValue = new Map(icpIndustries.map((industry) => [industry.value, industry]))
    const locationByValue = new Map(icpLocations.map((location) => [location.value, location]))
    const selectedIndustries = (Array.isArray(sourceConfig.icp?.industries) ? sourceConfig.icp.industries : []).filter((value) => industryByValue.has(value))
    const selectedLocations = (Array.isArray(sourceConfig.icp?.locations) ? sourceConfig.icp.locations : []).filter((value) => locationByValue.has(value))
    const adaptiveSourceKeys = new Set(catalog
        .filter((source) => source.enabled && source.implementation_status === "active")
        .filter((source) => ["licensing", "permits", "registries", "transport", "regulated", "procurement", "safety"].includes(source.family ?? ""))
        .map((source) => source.source_key))

    function compactSourceList(values: string[]) {
        if (values.length === 0) return "No source mappings yet"
        if (values.length <= 3) return `Maps to ${values.join(", ")}`
        return `Maps to ${values.slice(0, 3).join(", ")} +${values.length - 3} more`
    }

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
                description="Leadgen targeting, source readiness, and workspace presentation."
                bannerLabel="leadgen banner"
            />
            <LeadgenTabs workspaceSlug={workspace.slug} active="settings" />
            <ManualSettingsForm action={saveLeadgenSettings.bind(null, workspace.slug)}>
                <input type="hidden" name="settingsScope" value="settings" />
                <section className="grid gap-4 lg:grid-cols-[0.72fr_1.28fr]">
                    <div data-settings-section="poll-options" className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
                        <h2 className="text-lg font-semibold leading-6">Poll Automation</h2>
                        <p className="mt-1.5 text-sm leading-5 text-neutral-400">Cadence, run limits, and automated polling defaults.</p>
                        <div className="mt-4 grid gap-3">
                            <label className="block text-sm text-neutral-300">Automatic poll interval<input name="pollIntervalHours" type="number" min={1} max={2160} defaultValue={settings?.poll_interval_hours ?? 168} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" /><span className="mt-1.5 block text-xs leading-5 text-neutral-500">Hours between scheduled polls. 168 = weekly.</span></label>
                            <label className="block text-sm text-neutral-300">Candidate target count<input name="sourceConfig:icp:limit" type="number" min={10} max={5000} defaultValue={sourceConfig.icp?.limit ?? 1000} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" /><span className="mt-1.5 block text-xs leading-5 text-neutral-500">Upper bound before staged qualification.</span></label>
                            <label className="block text-sm text-neutral-300">Max owner-evidence depth<input name="sourceConfig:icp:maxEnrichmentDepth" type="number" min={1} max={8} defaultValue={sourceConfig.icp?.maxEnrichmentDepth ?? 4} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" /><span className="mt-1.5 block text-xs leading-5 text-neutral-500">How far the pipeline may chase owner evidence.</span></label>
                            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-300"><input name="automaticPollsEnabled" type="checkbox" defaultChecked={Boolean(settings?.automatic_polls_enabled)} className="h-4 w-4 shrink-0 accent-white" /><span>Run polls automatically on this cadence</span></label>
                            <label className="flex min-h-11 items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-300"><input name="sourceConfig:icp:ownerRequired" type="checkbox" defaultChecked={sourceConfig.icp?.ownerRequired !== false} className="h-4 w-4 shrink-0 accent-white" /><span>Only show qualified leads when owner/principal and phone evidence is found</span></label>
                            <input type="hidden" name="geography" value={settings?.geography ?? ""} />
                        </div>
                        <SettingsSectionActions section="poll-options" label="poll automation" />
                    </div>
                    <AdaptiveTargetingSettings industries={adaptiveIndustries} locations={adaptiveLocations} selectedIndustries={selectedIndustries} selectedLocations={selectedLocations} />
                </section>
            </ManualSettingsForm>
            <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
        </div>
    </main>
}
