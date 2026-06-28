import Link from "next/link"
import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { BrandLockup } from "@/components/brand/BrandLockup"
import { leadgenSourceFamilyLabels, sourceHealthMap, sourceMetadataNote, sourceStatusMeta, type LeadgenSourceCatalogRow, type LeadgenSourceHealthRow } from "@/lib/leadgen/source-catalog-ui"
import { buildSourcePlan, executableLeadgenSources, leadgenSourceOptions, type LeadgenSourceConfig, type LeadgenSourceKey } from "@/lib/leadgen/sources"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { createLeadgenPoll } from "../actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }
type SourceMapping = { source_key: LeadgenSourceKey; icp_industry_value?: string | null; icp_location_value?: string | null; native_values?: string[] | null }

function configObject(value: unknown): Partial<LeadgenSourceConfig> {
    return value && typeof value === "object" ? value as Partial<LeadgenSourceConfig> : {}
}

function sourceRequirement(sourceKey: LeadgenSourceKey, hasSeedSource: boolean) {
    if (sourceKey === "website" && !hasSeedSource) return "Needs a seed source first"
    if (sourceKey === "opencorporates") return "Planned registry source"
    if (sourceKey === "sam_gov") return "Validation-only source"
    return null
}

export default async function NewLeadgenPollPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace } = await requireWorkspace(workspaceSlug, "admin")
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
    const [industriesResult, locationsResult, industryMappingsResult, locationMappingsResult, catalogResult, healthResult] = await Promise.all([
        supabaseAdmin.from("leadgen_icp_industries").select("value, label").in("value", selectedIndustries.length ? selectedIndustries : ["__none__"]).order("label", { ascending: true }),
        supabaseAdmin.from("leadgen_icp_locations").select("value, label").in("value", selectedLocations.length ? selectedLocations : ["__none__"]).order("label", { ascending: true }),
        supabaseAdmin.from("leadgen_source_industry_mappings").select("source_key, icp_industry_value, native_values").eq("enabled", true),
        supabaseAdmin.from("leadgen_source_location_mappings").select("source_key, icp_location_value, native_values").eq("enabled", true),
        supabaseAdmin
            .from("leadgen_source_catalog")
            .select("source_key, label, family, source_points, owner_identity_points, owner_phone_points, business_support_points, access_method, free_status, implementation_status, run_stage, enabled, rate_limit_ms, coverage, metadata")
            .order("family", { ascending: true })
            .order("label", { ascending: true }),
        supabaseAdmin
            .from("leadgen_source_health")
            .select("source_key, status, last_success_at, last_failure_at, last_error, metadata"),
    ])
    const industryLabels = new Map((industriesResult.data ?? []).map((industry) => [industry.value, industry.label]))
    const locationLabels = new Map((locationsResult.data ?? []).map((location) => [location.value, location.label]))
    const industryMappings = (industryMappingsResult.error ? [] : industryMappingsResult.data ?? []) as SourceMapping[]
    const locationMappings = (locationMappingsResult.error ? [] : locationMappingsResult.data ?? []) as SourceMapping[]
    const catalog = (catalogResult.error ? [] : catalogResult.data ?? []) as LeadgenSourceCatalogRow[]
    const sourceHealth = sourceHealthMap((healthResult.error ? [] : healthResult.data ?? []) as LeadgenSourceHealthRow[])
    const hasSeedSource = sourcePlan.some((plan) => plan.key === "osm" || plan.key === "state_licensing" || plan.key === "overture")
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
    const seedSources = catalog.filter((source) => source.enabled && source.implementation_status === "active" && source.run_stage === "seed")
    const pollTimeSources = catalog.filter((source) => source.enabled && source.implementation_status === "active" && source.run_stage === "candidate_investigation")
    const validationSources = catalog.filter((source) => source.implementation_status === "validation_only")
    const deferredSources = catalog.filter((source) => ["bulk_refresh", "source_specific_configuration"].includes(source.run_stage ?? ""))

    return <main className="min-h-screen bg-neutral-950 px-5 py-8 text-white sm:px-8">
        <div className="mx-auto max-w-5xl">
            <header className="flex flex-col justify-between gap-5 border-b border-neutral-800 pb-6 sm:flex-row sm:items-center">
                <div>
                    <BrandLockup href={`https://leadgen.betelgeze.com/${workspace.slug}`} />
                    <div className="mt-5 flex flex-wrap gap-4 text-sm text-neutral-400">
                        <Link href={`https://leadgen.betelgeze.com/${workspace.slug}`}>← Leads</Link>
                        <Link href={`https://leadgen.betelgeze.com/${workspace.slug}/polls`}>Poll history</Link>
                        <Link href={`https://leadgen.betelgeze.com/${workspace.slug}/settings`}>Settings</Link>
                    </div>
                </div>
                <p className="text-sm text-neutral-500">{workspace.name}</p>
            </header>

            <section className="py-10">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">New poll</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight">Confirm candidate investigation</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">This poll will seed new businesses from the current ICP, then investigate each candidate across active free/public adapters. Sources that are validation-only, bulk-refresh, or endpoint-specific are shown here but will not pretend to run.</p>
            </section>

            <section className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
                <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                    <h2 className="text-lg font-semibold">ICP snapshot</h2>
                    <div className="mt-5 space-y-5">
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
                        <div className="grid grid-cols-2 gap-3">
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
                    <h2 className="text-lg font-semibold">Source stack</h2>
                    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {[
                            ["Seed", seedSources.length],
                            ["Poll-time", pollTimeSources.length],
                            ["Validation", validationSources.length],
                            ["Deferred", deferredSources.length],
                        ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                            <p className="text-xs text-neutral-500">{label}</p>
                            <p className="mt-1 text-lg font-semibold">{value}</p>
                        </div>)}
                    </div>

                    <div className="mt-4 divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-black">
                        {catalog.length ? catalog.filter((source) => ["active", "validation_only"].includes(source.implementation_status ?? "") || ["bulk_refresh", "source_specific_configuration"].includes(source.run_stage ?? "")).slice(0, 12).map((source) => {
                            const health = sourceHealth.get(source.source_key)
                            const meta = sourceStatusMeta(source, health)
                            return <div key={source.source_key} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(160px,1fr)_150px_minmax(0,1fr)] md:items-center">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-neutral-100">{source.label}</p>
                                    <p className="mt-1 truncate text-xs text-neutral-500">{leadgenSourceFamilyLabels[source.family] ?? source.family}</p>
                                </div>
                                <span className={`inline-flex items-center gap-2 text-sm ${meta.text}`}><BetelgezeStatusMark className={meta.mark} />{meta.label}</span>
                                <p className="truncate text-xs text-neutral-500">{sourceMetadataNote(source, health)}</p>
                            </div>
                        }) : <p className="px-4 py-3 text-sm text-neutral-500">No source catalogue found. Apply the source fan-out migrations before creating polls.</p>}
                    </div>

                    <h3 className="mt-5 font-medium text-neutral-100">Core execution readiness</h3>
                    <p className="mt-1 text-sm text-neutral-500">The poll can start only when the seed plan can actually create candidate tasks.</p>
                    <div className="mt-4 divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-black">
                        {sourceSummaries.map(({ source, enabled, ready, requirement, coveredIndustries, coveredLocations, mapped }) => {
                            const statusText = ready ? "Ready" : !enabled ? "Disabled" : requirement ? requirement : mapped ? "Mapped, waiting" : "Missing mappings"
                            const markClass = ready ? "bg-emerald-300" : enabled ? "bg-amber-300" : "bg-neutral-500"
                            const textClass = ready ? "text-emerald-200" : enabled ? "text-amber-200" : "text-neutral-500"
                            return <div key={source.value} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(160px,1fr)_170px_150px] md:items-center">
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
                        <p className="text-sm text-neutral-500">{readySources.length ? `${readySources.length} source${readySources.length === 1 ? "" : "s"} ready. The poll will appear in Poll history.` : "No source is ready. Open Settings and complete at least one source."}</p>
                    </form>
                </div>
            </section>
        </div>
    </main>
}
