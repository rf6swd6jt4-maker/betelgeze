import { WorkspaceIdentityEditor } from "@/components/admin/WorkspaceIdentityEditor"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { saveLeadgenSettings, updateLeadgenCoverLayout, updateLeadgenWorkspaceName, uploadLeadgenBanner, uploadSharedWorkspaceLogo } from "./actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }
const sourceOptions = [
    { value: "gbp_maps", label: "GBP / Maps", detail: "Research surface for local presence, reviews, categories, and listing quality." },
    { value: "state_licensing", label: "State contractor licensing boards", detail: "License status, trade category, owner/licensee names, and service geography." },
    { value: "secretary_of_state", label: "Secretary of State registries", detail: "Entity registration, legal name, age, officers, and addresses." },
    { value: "aggregator_directories", label: "Aggregator directories", detail: "Angi, Yelp, and similar directories for coverage and reputation clues." },
]

export default async function LeadgenSettingsPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const [bannerSrc, logoSrc] = await Promise.all([
        workspace.leadgen_banner_path ? createUploadSignedUrl(workspace.leadgen_banner_path) : null,
        workspace.logo_path ? createUploadSignedUrl(workspace.logo_path) : null,
    ])
    const settingsResult = await supabaseAdmin
        .from("leadgen_workspace_settings")
        .select("poll_interval_hours, automatic_polls_enabled, geography, icp_notes, enabled_sources")
        .eq("workspace_id", workspace.id)
        .maybeSingle()
    const settings = settingsResult.error ? null : settingsResult.data
    const enabledSources = new Set(Array.isArray(settings?.enabled_sources) ? settings.enabled_sources.map(String) : [])

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
                        <label className="block text-sm text-neutral-300">Target geography<input name="geography" defaultValue={settings?.geography ?? ""} placeholder="e.g. Texas HVAC contractors, Florida roofers" className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /></label>
                        <label className="block text-sm text-neutral-300 md:col-span-2">ICP notes<textarea name="icpNotes" defaultValue={settings?.icp_notes ?? ""} rows={5} placeholder="Company size, services, revenue band, licensing requirements, review profile, and disqualifiers." className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /></label>
                    </div>
                </section>
                <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                    <h2 className="text-lg font-semibold">Sources</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Enable the source families this workspace should poll. Credentials and connector-specific controls will be added as each source comes online.</p>
                    <div className="mt-5 grid gap-3 lg:grid-cols-2">
                        {sourceOptions.map((source) => <label key={source.value} className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                            <span className="flex items-start gap-3"><input name="sources" value={source.value} type="checkbox" defaultChecked={enabledSources.has(source.value)} className="mt-1 h-4 w-4 accent-white" /><span><span className="block font-medium text-white">{source.label}</span><span className="mt-1 block text-sm leading-6 text-neutral-400">{source.detail}</span></span></span>
                        </label>)}
                    </div>
                </section>
                <button className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Save leadgen settings</button>
            </form>
            <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
        </div>
    </main>
}
