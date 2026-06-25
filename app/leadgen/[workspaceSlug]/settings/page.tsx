import { WorkspaceIdentityEditor } from "@/components/admin/WorkspaceIdentityEditor"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { SearchableMultiSelect } from "@/components/leadgen/SearchableMultiSelect"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { leadgenSourceOptions, type LeadgenSourceConfig } from "@/lib/leadgen/sources"
import { saveLeadgenSettings, updateLeadgenCoverLayout, updateLeadgenWorkspaceName, uploadLeadgenBanner, uploadSharedWorkspaceLogo } from "./actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }
type SourceOption = { source_key: string; option_kind: "industry" | "location"; value: string; label: string }
type GeoTarget = { value: string; label: string }
const runnableSources = new Set(["yelp"])

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
    const [settingsResult, optionsResult, geoTargetsResult] = await Promise.all([
        supabaseAdmin
        .from("leadgen_workspace_settings")
        .select("poll_interval_hours, automatic_polls_enabled, geography, icp_notes, enabled_sources, source_config")
        .eq("workspace_id", workspace.id)
        .maybeSingle(),
        supabaseAdmin
            .from("leadgen_source_options")
            .select("source_key, option_kind, value, label")
            .eq("enabled", true)
            .order("label", { ascending: true }),
        supabaseAdmin
            .from("leadgen_geo_targets")
            .select("value, label")
            .eq("enabled", true)
            .order("label", { ascending: true }),
    ])
    const settings = settingsResult.error ? null : settingsResult.data
    const enabledSources = new Set(Array.isArray(settings?.enabled_sources) ? settings.enabled_sources.map(String) : [])
    const sourceConfig = sourceConfigValue(settings?.source_config)
    const sourceOptions = (optionsResult.error ? [] : optionsResult.data ?? []) as SourceOption[]
    const geoTargets = (geoTargetsResult.error ? [] : geoTargetsResult.data ?? []) as GeoTarget[]

    function optionsFor(sourceKey: string, kind: SourceOption["option_kind"]) {
        return sourceOptions
            .filter((option) => option.source_key === sourceKey && option.option_kind === kind)
            .map((option) => ({ value: option.value, label: option.label }))
    }

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
            <form action={saveLeadgenSettings.bind(null, workspace.slug)} className="mt-8 space-y-4">
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
                            <SearchableMultiSelect name="sourceConfig:icp:locations" label="Target locations" options={geoTargets.map((target) => ({ value: target.value, label: target.label }))} selectedValues={Array.isArray(sourceConfig.icp?.locations) ? sourceConfig.icp.locations : []} />
                            <SearchableMultiSelect name="sourceConfig:icp:industries" label="Target industries" options={optionsFor("icp", "industry")} selectedValues={Array.isArray(sourceConfig.icp?.industries) ? sourceConfig.icp.industries : []} />
                            <label className="block text-sm text-neutral-300 md:col-span-2">ICP notes<textarea name="icpNotes" defaultValue={settings?.icp_notes ?? ""} rows={3} placeholder="Company size, services, revenue band, licensing requirements, review profile, and disqualifiers." className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /></label>
                            <input type="hidden" name="geography" value={settings?.geography ?? ""} />
                        </div>
                    </div>
                </section>
                <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div>
                            <h2 className="text-lg font-semibold">Sources</h2>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Enable source families. Common targeting comes from ICP above; source-specific taxonomies live under Advanced.</p>
                        </div>
                    </div>
                    <div className="mt-5 grid gap-3 xl:grid-cols-4">
                        {leadgenSourceOptions.map((source) => {
                            const config = sourceConfig[source.value]
                            const locationOptions = optionsFor(source.value, "location")
                            const industryOptions = optionsFor(source.value, "industry")
                            const implemented = runnableSources.has(source.value)
                            const usesSharedIcp = source.value === "yelp" || source.value === "osm"
                            const hasOptionDatabase = implemented && (usesSharedIcp || locationOptions.length > 0 || industryOptions.length > 0)
                            const sourceSettings = sourceConfig[source.value]
                            return <div key={source.value} className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                                <label className="flex min-h-24 items-start gap-3">
                                    <input name="sources" value={source.value} type="checkbox" defaultChecked={enabledSources.has(source.value) && hasOptionDatabase} disabled={!hasOptionDatabase} className="mt-1 h-4 w-4 accent-white disabled:opacity-40" />
                                    <span>
                                        <span className="block font-medium text-white">{source.label}</span>
                                        <span className="mt-1 block text-sm leading-5 text-neutral-400">{source.detail}</span>
                                        {implemented && usesSharedIcp && <span className="mt-2 block text-xs text-emerald-200">Uses the shared ICP selectors.</span>}
                                        {!implemented && <span className="mt-2 block text-xs text-amber-200">Planned source. Worker not implemented yet.</span>}
                                        {implemented && !hasOptionDatabase && <span className="mt-2 block text-xs text-amber-200">Waiting for verified target options before this source can run.</span>}
                                    </span>
                                </label>
                                {source.value === "yelp" && <details className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
                                    <summary className="cursor-pointer text-sm font-medium text-neutral-300">Yelp execution settings</summary>
                                    <div className="mt-4 grid gap-3">
                                        <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Results per industry/location<input name="sourceConfig:yelp:limit" type="number" min={1} max={50} defaultValue={sourceSettings?.limit ?? 10} className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>
                                        <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Radius in metres<input name="sourceConfig:yelp:radiusMeters" type="number" min={1000} max={40000} defaultValue={sourceSettings?.radiusMeters ?? 24000} className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>
                                        <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Notes<textarea name="sourceConfig:yelp:notes" defaultValue={sourceSettings?.notes ?? ""} rows={2} placeholder={source.notesPlaceholder} className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-neutral-600" /></label>
                                    </div>
                                </details>}
                                {hasOptionDatabase && !usesSharedIcp && <details className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
                                    <summary className="cursor-pointer text-sm font-medium text-neutral-300">Advanced filters</summary>
                                    <div className="mt-4 grid gap-3">
                                        {locationOptions.length > 0 && <SearchableMultiSelect name={`sourceConfig:${source.value}:locations`} label="Locations" options={locationOptions} selectedValues={Array.isArray(config?.locations) ? config.locations : []} />}
                                        {industryOptions.length > 0 && <SearchableMultiSelect name={`sourceConfig:${source.value}:industries`} label="License / record types" options={industryOptions} selectedValues={Array.isArray(config?.industries) ? config.industries : []} />}
                                        <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Notes<textarea name={`sourceConfig:${source.value}:notes`} defaultValue={config?.notes ?? ""} rows={2} placeholder={source.notesPlaceholder} className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-neutral-600" /></label>
                                    </div>
                                </details>}
                            </div>
                        })}
                    </div>
                </section>
                <button className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Save leadgen settings</button>
            </form>
            <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
        </div>
    </main>
}
