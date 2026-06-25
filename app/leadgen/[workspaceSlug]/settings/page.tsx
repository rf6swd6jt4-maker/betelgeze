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
    const [settingsResult, optionsResult] = await Promise.all([
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
    ])
    const settings = settingsResult.error ? null : settingsResult.data
    const enabledSources = new Set(Array.isArray(settings?.enabled_sources) ? settings.enabled_sources.map(String) : [])
    const sourceConfig = sourceConfigValue(settings?.source_config)
    const sourceOptions = (optionsResult.error ? [] : optionsResult.data ?? []) as SourceOption[]

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
            <form action={saveLeadgenSettings.bind(null, workspace.slug)} className="mt-8 space-y-5">
                <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                    <h2 className="text-lg font-semibold">Poll options</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Polls are the recurring source runs that will feed sourcing, normalisation, dedupe, enrichment, validation, scoring, and routing.</p>
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                        <label className="block text-sm text-neutral-300">Automatic poll interval<input name="pollIntervalHours" type="number" min={1} max={2160} defaultValue={settings?.poll_interval_hours ?? 168} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /><span className="mt-1 block text-xs text-neutral-500">Hours between scheduled polls. 168 = weekly.</span></label>
                        <label className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-300"><input name="automaticPollsEnabled" type="checkbox" defaultChecked={Boolean(settings?.automatic_polls_enabled)} className="h-4 w-4 accent-white" />Run polls automatically on this cadence</label>
                    </div>
                </section>
                <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                    <h2 className="text-lg font-semibold">ICP</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Fit scoring will compare each company against this profile before intent signals are layered on.</p>
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                        <label className="block text-sm text-neutral-300">Target geography<input name="geography" defaultValue={settings?.geography ?? ""} placeholder="Internal notes only; source locations are selected below." className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /><span className="mt-1 block text-xs text-neutral-500">Use this for human notes. Poll source locations come from the database-backed source selectors below.</span></label>
                        <label className="block text-sm text-neutral-300 md:col-span-2">ICP notes<textarea name="icpNotes" defaultValue={settings?.icp_notes ?? ""} rows={5} placeholder="Company size, services, revenue band, licensing requirements, review profile, and disqualifiers." className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /></label>
                    </div>
                </section>
                <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                    <h2 className="text-lg font-semibold">Sources</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Enable the source families this workspace should poll and give each source enough targeting context for the first worker pass. Credentials and connector-specific controls will be added as each source comes online.</p>
                    <div className="mt-5 grid gap-3 lg:grid-cols-2">
                        {leadgenSourceOptions.map((source) => {
                            const config = sourceConfig[source.value]
                            const locationOptions = optionsFor(source.value, "location")
                            const industryOptions = optionsFor(source.value, "industry")
                            const hasOptionDatabase = locationOptions.length > 0 || industryOptions.length > 0
                            return <div key={source.value} className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                                <label className="flex items-start gap-3">
                                    <input name="sources" value={source.value} type="checkbox" defaultChecked={enabledSources.has(source.value) && hasOptionDatabase} disabled={!hasOptionDatabase} className="mt-1 h-4 w-4 accent-white disabled:opacity-40" />
                                    <span>
                                        <span className="block font-medium text-white">{source.label}</span>
                                        <span className="mt-1 block text-sm leading-6 text-neutral-400">{source.detail}</span>
                                        {!hasOptionDatabase && <span className="mt-2 block text-xs text-amber-200">Waiting for a verified option database before this source can be enabled.</span>}
                                    </span>
                                </label>
                                {hasOptionDatabase && <div className="mt-4 grid gap-3">
                                    {locationOptions.length > 0 && <SearchableMultiSelect name={`sourceConfig:${source.value}:locations`} label="Locations" options={locationOptions} selectedValues={Array.isArray(config?.locations) ? config.locations : []} />}
                                    {industryOptions.length > 0 && <SearchableMultiSelect name={`sourceConfig:${source.value}:industries`} label="Industries / record types" options={industryOptions} selectedValues={Array.isArray(config?.industries) ? config.industries : []} />}
                                    <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Notes<textarea name={`sourceConfig:${source.value}:notes`} defaultValue={config?.notes ?? ""} rows={2} placeholder={source.notesPlaceholder} className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-neutral-600" /></label>
                                </div>}
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
