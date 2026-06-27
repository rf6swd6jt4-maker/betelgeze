import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { buildSourcePlan, executableLeadgenSources, leadgenSourceOptions, type LeadgenSourceConfig, type LeadgenSourceKey } from "@/lib/leadgen/sources"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { createLeadgenPoll } from "../../actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }
type SourceMapping = { source_key: LeadgenSourceKey; icp_industry_value?: string | null; icp_location_value?: string | null; native_values?: string[] | null }

function configObject(value: unknown): Partial<LeadgenSourceConfig> {
    return value && typeof value === "object" ? value as Partial<LeadgenSourceConfig> : {}
}

function sourceRequirement(sourceKey: LeadgenSourceKey, hasSeedSource: boolean) {
    if (sourceKey === "overture") return process.env.OVERTURE_DUCKDB_ENDPOINT ? null : "Missing Overture GeoParquet adapter"
    if (sourceKey === "website" && !hasSeedSource) return "Needs a seed source first"
    if (sourceKey === "opencorporates") return process.env.OPENCORPORATES_API_KEY ? null : "Missing OpenCorporates API key"
    if (sourceKey === "sam_gov") return process.env.SAM_GOV_API_KEY ? null : "Missing SAM.gov API key"
    return null
}

export default async function NewLeadgenPollPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const settingsResult = await supabaseAdmin
        .from("leadgen_workspace_settings")
        .select("enabled_sources, source_config")
        .eq("workspace_id", workspace.id)
        .maybeSingle()
    const settings = settingsResult.error ? null : settingsResult.data
    const enabledSources = Array.isArray(settings?.enabled_sources) ? settings.enabled_sources.map(String) : []
    const sourceConfig = configObject(settings?.source_config)
    const sourcePlan = buildSourcePlan(enabledSources, sourceConfig)
    const selectedIndustries = sourceConfig.icp?.industries ?? []
    const selectedLocations = sourceConfig.icp?.locations ?? []
    const [industriesResult, locationsResult, industryMappingsResult, locationMappingsResult] = await Promise.all([
        supabaseAdmin.from("leadgen_icp_industries").select("value, label").in("value", selectedIndustries.length ? selectedIndustries : ["__none__"]).order("label", { ascending: true }),
        supabaseAdmin.from("leadgen_icp_locations").select("value, label").in("value", selectedLocations.length ? selectedLocations : ["__none__"]).order("label", { ascending: true }),
        supabaseAdmin.from("leadgen_source_industry_mappings").select("source_key, icp_industry_value, native_values").eq("enabled", true),
        supabaseAdmin.from("leadgen_source_location_mappings").select("source_key, icp_location_value, native_values").eq("enabled", true),
    ])
    const industryLabels = new Map((industriesResult.data ?? []).map((industry) => [industry.value, industry.label]))
    const locationLabels = new Map((locationsResult.data ?? []).map((location) => [location.value, location.label]))
    const industryMappings = (industryMappingsResult.error ? [] : industryMappingsResult.data ?? []) as SourceMapping[]
    const locationMappings = (locationMappingsResult.error ? [] : locationMappingsResult.data ?? []) as SourceMapping[]
    const hasSeedSource = sourcePlan.some((plan) => plan.key === "osm" || plan.key === "state_licensing" || plan.key === "sam_gov" || (plan.key === "overture" && Boolean(process.env.OVERTURE_DUCKDB_ENDPOINT)))

    const sourceSummaries = leadgenSourceOptions.map((source) => {
        const plan = sourcePlan.find((item) => item.key === source.value)
        const mappedIndustries = new Set(industryMappings.filter((mapping) => mapping.source_key === source.value && (mapping.native_values?.length ?? 0) > 0).map((mapping) => mapping.icp_industry_value).filter(Boolean))
        const mappedLocations = new Set(locationMappings.filter((mapping) => mapping.source_key === source.value && (mapping.native_values?.length ?? 0) > 0).map((mapping) => mapping.icp_location_value).filter(Boolean))
        const coveredIndustries = selectedIndustries.filter((value) => mappedIndustries.has(value)).length
        const coveredLocations = selectedLocations.filter((value) => mappedLocations.has(value)).length
        const requirement = sourceRequirement(source.value, hasSeedSource)
        const enabled = Boolean(plan)
        const mapped = selectedIndustries.length > 0 && selectedLocations.length > 0 && coveredIndustries > 0 && coveredLocations > 0
        const ready = enabled && executableLeadgenSources.has(source.value) && mapped && !requirement
        return { source, enabled, ready, requirement, coveredIndustries, coveredLocations, mapped }
    })
    const readySources = sourceSummaries.filter((summary) => summary.ready)

    return <main className="min-h-screen bg-neutral-950 px-4 py-5 text-white sm:px-6 sm:py-6">
        <div className="mx-auto max-w-7xl">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
            <WorkspaceBanner bannerPath={workspace.leadgen_banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.leadgen_banner_height} position={workspace.leadgen_banner_position} />
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">New poll</p>
                    <h1 className="mt-2 text-2xl font-semibold tracking-tight">Confirm source polling</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">This screen checks the current ICP and source readiness. To change targets, limits, API keys, or source settings, use Settings first.</p>
                </div>
                <Link href={`https://leadgen.betelgeze.com/${workspace.slug}/settings`} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300">Open Settings</Link>
            </div>

            <LeadgenTabs workspaceSlug={workspace.slug} active="polls" />

            <section className="mt-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
                <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                    <h2 className="text-lg font-semibold">ICP snapshot</h2>
                    <div className="mt-4 space-y-4">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Industries</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {selectedIndustries.length ? selectedIndustries.map((value) => <span key={value} className="rounded-full bg-neutral-950 px-3 py-1 text-xs text-neutral-200">{industryLabels.get(value) ?? value.replace(/_/g, " ")}</span>) : <span className="text-sm text-amber-200">No industries selected</span>}
                            </div>
                        </div>
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Locations</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {selectedLocations.length ? selectedLocations.map((value) => <span key={value} className="rounded-full bg-neutral-950 px-3 py-1 text-xs text-neutral-200">{locationLabels.get(value) ?? value.replace(/_/g, " ")}</span>) : <span className="text-sm text-amber-200">No locations selected</span>}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 pt-2">
                            <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                                <p className="text-xs text-neutral-500">Candidate cap</p>
                                <p className="mt-1 text-lg font-semibold">{sourceConfig.icp?.limit ?? 1000}</p>
                            </div>
                            <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                                <p className="text-xs text-neutral-500">Owner required</p>
                                <p className="mt-1 text-lg font-semibold">{sourceConfig.icp?.ownerRequired === false ? "No" : "Yes"}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                    <h2 className="text-lg font-semibold">Connected source summary</h2>
                    <div className="mt-4 divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-black">
                        {sourceSummaries.map(({ source, enabled, ready, requirement, coveredIndustries, coveredLocations, mapped }) => {
                            const statusText = ready ? "Connected" : !enabled ? "Disabled" : requirement ? requirement : mapped ? "Waiting for worker readiness" : "Missing mappings"
                            const markClass = ready ? "bg-emerald-300" : enabled ? "bg-amber-300" : "bg-neutral-500"
                            const textClass = ready ? "text-emerald-200" : enabled ? "text-amber-200" : "text-neutral-500"
                            return <div key={source.value} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(160px,1fr)_170px_170px] md:items-center">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-neutral-100">{source.label}</p>
                                    <p className="mt-1 truncate text-xs text-neutral-500">{source.detail}</p>
                                </div>
                                <p className="text-xs text-neutral-500"><span className="text-neutral-200">{coveredIndustries}/{selectedIndustries.length}</span> industries · <span className="text-neutral-200">{coveredLocations}/{selectedLocations.length}</span> locations</p>
                                <span className={`inline-flex items-center gap-2 text-sm ${textClass}`}><BetelgezeStatusMark className={markClass} />{statusText}</span>
                            </div>
                        })}
                    </div>
                    <form action={createLeadgenPoll.bind(null, workspace.slug)} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                        <button disabled={readySources.length === 0} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400">Confirm new poll</button>
                        <p className="text-sm text-neutral-500">{readySources.length ? `${readySources.length} connected source${readySources.length === 1 ? "" : "s"} will be checked, then the poll will open in Polls.` : "No connected source is ready. Open Settings and complete at least one source."}</p>
                    </form>
                </div>
            </section>
            <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
        </div>
    </main>
}
