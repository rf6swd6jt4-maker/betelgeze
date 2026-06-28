import { WorkspaceIdentityEditor } from "@/components/admin/WorkspaceIdentityEditor"
import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { SearchableMultiSelect } from "@/components/leadgen/SearchableMultiSelect"
import { SourceSettingsCard, type SourceSettingsItem } from "@/components/leadgen/SourceSettingsCard"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { leadgenSourceFamilyLabels, leadgenSourceFamilyOrder, sourceHealthMap, sourceMetadataNote, sourcePointSummary, sourceStatusMeta, type LeadgenSourceCatalogRow, type LeadgenSourceHealthRow } from "@/lib/leadgen/source-catalog-ui"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { executableLeadgenSources, leadgenSourceOptions, type LeadgenSourceConfig, type LeadgenSourceKey } from "@/lib/leadgen/sources"
import { saveLeadgenSettings, updateLeadgenCoverLayout, updateLeadgenWorkspaceName, uploadLeadgenBanner, uploadSharedWorkspaceLogo } from "./actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }
type IcpOption = { value: string; label: string }
type SourceMapping = { source_key: LeadgenSourceKey; icp_industry_value?: string | null; icp_location_value?: string | null; native_values?: string[] | null }

function sourceConfigValue(config: unknown): Partial<LeadgenSourceConfig> {
    return config && typeof config === "object" ? config as Partial<LeadgenSourceConfig> : {}
}

function sourceCategory(sourceKey: LeadgenSourceKey): SourceSettingsItem["category"] {
    if (sourceKey === "state_licensing" || sourceKey === "sam_gov") return "industry"
    if (sourceKey === "opencorporates") return "location"
    return "general"
}

export default async function LeadgenSettingsPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const [bannerSrc, logoSrc] = await Promise.all([
        workspace.leadgen_banner_path ? createUploadSignedUrl(workspace.leadgen_banner_path) : null,
        workspace.logo_path ? createUploadSignedUrl(workspace.logo_path) : null,
    ])
    const [settingsResult, industriesResult, locationsResult, industryMappingsResult, locationMappingsResult, catalogResult, healthResult] = await Promise.all([
        supabaseAdmin
        .from("leadgen_workspace_settings")
        .select("poll_interval_hours, automatic_polls_enabled, geography, icp_notes, enabled_sources, source_config")
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
            .select("source_key, label, family, source_points, owner_identity_points, owner_phone_points, business_support_points, access_method, free_status, implementation_status, run_stage, enabled, rate_limit_ms, coverage, metadata")
            .order("family", { ascending: true })
            .order("label", { ascending: true }),
        supabaseAdmin
            .from("leadgen_source_health")
            .select("source_key, status, last_success_at, last_failure_at, last_error, metadata"),
    ])
    const settings = settingsResult.error ? null : settingsResult.data
    const enabledSources = new Set(Array.isArray(settings?.enabled_sources) ? settings.enabled_sources.map(String) : [])
    const sourceConfig = sourceConfigValue(settings?.source_config)
    const icpIndustries = (industriesResult.error ? [] : industriesResult.data ?? []) as IcpOption[]
    const icpLocations = (locationsResult.error ? [] : locationsResult.data ?? []) as IcpOption[]
    const industryMappings = (industryMappingsResult.error ? [] : industryMappingsResult.data ?? []) as SourceMapping[]
    const locationMappings = (locationMappingsResult.error ? [] : locationMappingsResult.data ?? []) as SourceMapping[]
    const catalog = (catalogResult.error ? [] : catalogResult.data ?? []) as LeadgenSourceCatalogRow[]
    const sourceHealth = sourceHealthMap((healthResult.error ? [] : healthResult.data ?? []) as LeadgenSourceHealthRow[])
    const selectedIndustries = Array.isArray(sourceConfig.icp?.industries) ? sourceConfig.icp.industries : []
    const selectedLocations = Array.isArray(sourceConfig.icp?.locations) ? sourceConfig.icp.locations : []
    const activeCatalogSources = catalog.filter((source) => source.enabled && source.implementation_status === "active")
    const validationOnlyCount = catalog.filter((source) => source.implementation_status === "validation_only").length
    const needsWorkCount = catalog.filter((source) => ["source_specific_configuration", "bulk_refresh"].includes(source.run_stage ?? "")).length
    const blockedCount = catalog.filter((source) => source.implementation_status === "blocked" || source.run_stage === "blocked").length
    const groupedCatalog = leadgenSourceFamilyOrder
        .map((family) => ({ family, sources: catalog.filter((source) => source.family === family) }))
        .filter((group) => group.sources.length > 0)

    function mappingSummary(sourceKey: LeadgenSourceKey) {
        const mappedIndustries = new Set(industryMappings.filter((mapping) => mapping.source_key === sourceKey && (mapping.native_values?.length ?? 0) > 0).map((mapping) => mapping.icp_industry_value).filter(Boolean))
        const mappedLocations = new Set(locationMappings.filter((mapping) => mapping.source_key === sourceKey && (mapping.native_values?.length ?? 0) > 0).map((mapping) => mapping.icp_location_value).filter(Boolean))
        const selectedIndustryCount = selectedIndustries.length
        const selectedLocationCount = selectedLocations.length
        const coveredIndustryCount = selectedIndustries.filter((value) => mappedIndustries.has(value)).length
        const coveredLocationCount = selectedLocations.filter((value) => mappedLocations.has(value)).length
        return {
            industryText: selectedIndustryCount ? `${coveredIndustryCount}/${selectedIndustryCount} industries mapped` : "Choose ICP industries",
            locationText: selectedLocationCount ? `${coveredLocationCount}/${selectedLocationCount} locations mapped` : "Choose ICP locations",
            ready: selectedIndustryCount > 0 && selectedLocationCount > 0 && coveredIndustryCount > 0 && coveredLocationCount > 0,
        }
    }

    const sourceItems: SourceSettingsItem[] = leadgenSourceOptions.map((source) => {
        const implemented = executableLeadgenSources.has(source.value)
        const sourceSettings = sourceConfig[source.value]
        const mapped = mappingSummary(source.value)
        const apiKeyConfigured = source.value === "sam_gov" ? Boolean(process.env.SAM_GOV_API_KEY) : true
        const configured = implemented && mapped.ready && apiKeyConfigured
        return {
            value: source.value,
            label: source.label,
            detail: source.detail,
            statusLabel: source.statusLabel,
            notesPlaceholder: source.notesPlaceholder,
            category: sourceCategory(source.value),
            configured,
            enabled: configured && enabledSources.has(source.value),
            implemented,
            apiKeyConfigured,
            envVar: source.envVar ?? null,
            setupHint: source.setupHint ?? null,
            mappingIndustryText: mapped.industryText,
            mappingLocationText: mapped.locationText,
            settings: {
                limit: sourceSettings?.limit ?? (source.value === "overture" ? 100 : source.value === "state_licensing" ? 15 : 25),
                radiusMeters: sourceSettings?.radiusMeters ?? 24000,
                crawlDepth: sourceSettings?.crawlDepth ?? 2,
                timeoutSeconds: sourceSettings?.timeoutSeconds ?? 10,
                respectRobots: sourceSettings?.respectRobots !== false,
                release: sourceSettings?.release ?? "2026-06-17.0",
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
                            <SearchableMultiSelect name="sourceConfig:icp:locations" label="Target locations" options={icpLocations.map((target) => ({ value: target.value, label: target.label }))} selectedValues={selectedLocations} />
                            <SearchableMultiSelect name="sourceConfig:icp:industries" label="Target industries" options={icpIndustries.map((industry) => ({ value: industry.value, label: industry.label }))} selectedValues={selectedIndustries} />
                            <label className="block text-sm text-neutral-300">Candidate target count<input name="sourceConfig:icp:limit" type="number" min={10} max={5000} defaultValue={sourceConfig.icp?.limit ?? 1000} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /><span className="mt-1 block text-xs text-neutral-500">Upper bound for seed candidates before enrichment and qualification.</span></label>
                            <label className="block text-sm text-neutral-300">Max enrichment depth<input name="sourceConfig:icp:maxEnrichmentDepth" type="number" min={1} max={8} defaultValue={sourceConfig.icp?.maxEnrichmentDepth ?? 4} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /><span className="mt-1 block text-xs text-neutral-500">How far the pipeline may chase owner/phone evidence across supporting sources.</span></label>
                            <label className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-300 md:col-span-2"><input name="sourceConfig:icp:ownerRequired" type="checkbox" defaultChecked={sourceConfig.icp?.ownerRequired !== false} className="h-4 w-4 accent-white" />Only show qualified leads when owner/principal and phone evidence is found</label>
                            <label className="block text-sm text-neutral-300 md:col-span-2">ICP notes<textarea name="icpNotes" defaultValue={settings?.icp_notes ?? ""} rows={3} placeholder="Company size, services, revenue band, licensing requirements, review profile, and disqualifiers." className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /></label>
                            <input type="hidden" name="geography" value={settings?.geography ?? ""} />
                        </div>
                    </div>
                </section>
                <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div>
                            <h2 className="text-lg font-semibold">Sources</h2>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">The poll now seeds candidates first, then investigates each company across the public-source catalogue. The switches below control the core workspace execution plan; the catalogue shows what the fan-out can honestly do today.</p>
                        </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {[
                            ["Active", activeCatalogSources.length],
                            ["Validation only", validationOnlyCount],
                            ["Needs work", needsWorkCount],
                            ["Blocked", blockedCount],
                        ].map(([label, value]) => <div key={label} className="rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                            <p className="text-xs text-neutral-500">{label}</p>
                            <p className="mt-1 text-lg font-semibold">{value}</p>
                        </div>)}            </div>

                    <div className="mt-5 rounded-xl border border-neutral-800 bg-black">
                        <div className="border-b border-neutral-800 px-4 py-3">
                            <h3 className="font-medium text-neutral-100">Source catalogue truth layer</h3>
                            <p className="mt-1 text-sm text-neutral-500">Point split is owner identity / owner phone / business support. Only poll-time and seed sources run during a poll.</p>
                        </div>
                        <div className="divide-y divide-neutral-900">
                            {groupedCatalog.length ? groupedCatalog.map((group) => <details key={group.family} className="group">
                                <summary className="grid cursor-pointer gap-2 px-4 py-3 md:grid-cols-[170px_1fr_120px] md:items-center">
                                    <span className="text-sm font-medium text-neutral-100">{leadgenSourceFamilyLabels[group.family] ?? group.family}</span>
                                    <span className="text-sm text-neutral-500">{group.sources.filter((source) => source.enabled && source.implementation_status === "active").length} active · {group.sources.length} catalogued</span>
                                    <span className="text-right text-xs uppercase tracking-[0.14em] text-neutral-600">open</span>
                                </summary>
                                <div className="divide-y divide-neutral-900 border-t border-neutral-900">
                                    {group.sources.map((source) => {
                                        const health = sourceHealth.get(source.source_key)
                                        const meta = sourceStatusMeta(source, health)
                                        return <div key={source.source_key} className={`grid gap-3 px-4 py-3 md:grid-cols-[minmax(180px,0.9fr)_130px_120px_minmax(0,1.2fr)] md:items-center ${meta.muted ? "opacity-75" : ""}`}>
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-neutral-100">{source.label}</p>
                                                <p className="mt-1 truncate font-mono text-xs text-neutral-600">{source.source_key}</p>
                                            </div>
                                            <span className={`inline-flex items-center gap-2 text-sm ${meta.text}`}><BetelgezeStatusMark className={meta.mark} />{meta.label}</span>
                                            <p className="text-sm text-neutral-500">{sourcePointSummary(source)}</p>
                                            <p className="min-w-0 truncate text-sm text-neutral-500">{sourceMetadataNote(source, health)}</p>
                                        </div>
                                    })}
                                </div>
                            </details>) : <p className="p-4 text-sm text-neutral-500">No source catalogue rows found. Apply the leadgen source fan-out migrations before testing polls.</p>}
                        </div>
                    </div>

                    <div className="mt-6">
                        <h3 className="font-medium text-neutral-100">Workspace execution switches</h3>
                        <p className="mt-1 text-sm text-neutral-500">Keep this concise: Overture seeds new candidates; website and licensing switches let the older source-plan workers run alongside the catalogue fan-out.</p>
                    </div>
                    <div className="mt-5 grid gap-3 xl:grid-cols-3">
                        {leadgenSourceOptions.map((source) => {
                            const implemented = executableLeadgenSources.has(source.value)
                            const sourceSettings = sourceConfig[source.value]
                            const mapped = mappingSummary(source.value)
                            const apiKeyConfigured = source.value === "sam_gov" ? Boolean(process.env.SAM_GOV_API_KEY) : true
                            const adapterConfigured = true
                            const canRun = implemented && mapped.ready && apiKeyConfigured && adapterConfigured
                            return <div key={source.value} className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                                <label className="flex min-h-24 items-start gap-3">
                                    <input name="sources" value={source.value} type="checkbox" defaultChecked={enabledSources.has(source.value)} disabled={!canRun} className="mt-1 h-4 w-4 accent-white disabled:opacity-40" />
                                    <span>
                                        <span className="block font-medium text-white">{source.label}</span>
                                        <span className="mt-1 block text-sm leading-5 text-neutral-400">{source.detail}</span>
                                        <span className={`mt-2 block text-xs ${canRun ? "text-emerald-200" : implemented ? "text-amber-200" : "text-neutral-500"}`}>{implemented ? source.statusLabel : "Planned source"}</span>
                                    </span>
                                </label>
                                <div className="mt-3 grid gap-2 rounded-lg border border-neutral-900 bg-black/40 p-3 text-xs text-neutral-400">
                                    <div className="flex items-center justify-between gap-2"><span>Industry mapping</span><span className={mapped.industryText.includes("0/") ? "text-amber-200" : "text-neutral-300"}>{mapped.industryText}</span></div>
                                    <div className="flex items-center justify-between gap-2"><span>Location mapping</span><span className={mapped.locationText.includes("0/") ? "text-amber-200" : "text-neutral-300"}>{mapped.locationText}</span></div>
                                    {source.value === "overture" && <div className="flex items-center justify-between gap-2"><span>Adapter</span><span className="text-emerald-200">Built in</span></div>}
                                    {source.requiresApiKey && <div className="flex items-center justify-between gap-2"><span>API key</span><span className={apiKeyConfigured ? "text-emerald-200" : "text-amber-200"}>{apiKeyConfigured ? "Configured" : "Missing in Vercel"}</span></div>}
                                    {source.envVar && <div className="rounded-lg border border-neutral-900 bg-neutral-950 p-2">
                                        <p className="font-mono text-[11px] text-neutral-300">{source.envVar}</p>
                                        {source.setupHint && <p className="mt-1 leading-5 text-neutral-500">{source.setupHint}</p>}
                                    </div>}
                                </div>
                                <details className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
                                    <summary className="cursor-pointer text-sm font-medium text-neutral-300">Technical settings</summary>
                                    <div className="mt-4 grid gap-3">
                                        {source.value === "overture" && <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Release/version<input name="sourceConfig:overture:release" defaultValue={sourceSettings?.release ?? "2026-06-17.0"} className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>}
                                        {source.value === "website" && <>
                                            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Crawl depth<input name="sourceConfig:website:crawlDepth" type="number" min={1} max={5} defaultValue={sourceSettings?.crawlDepth ?? 2} className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>
                                            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Timeout seconds<input name="sourceConfig:website:timeoutSeconds" type="number" min={3} max={30} defaultValue={sourceSettings?.timeoutSeconds ?? 10} className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>
                                            <label className="flex items-center gap-2 text-xs text-neutral-300"><input name="sourceConfig:website:respectRobots" type="checkbox" defaultChecked={sourceSettings?.respectRobots !== false} className="h-4 w-4 accent-white" />Respect robots controls</label>
                                        </>
                                        <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Max records per mapped task<input name={`sourceConfig:${source.value}:limit`} type="number" min={1} max={source.value === "overture" ? 500 : 50} defaultValue={sourceSettings?.limit ?? (source.value === "overture" ? 100 : source.value === "state_licensing" ? 15 : 25)} className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>
                                        {(source.value === "osm" || source.value === "overture") && <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Radius in metres<input name={`sourceConfig:${source.value}:radiusMeters`} type="number" min={1000} max={40000} defaultValue={sourceSettings?.radiusMeters ?? 24000} className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm normal-case tracking-normal text-white" /></label>}
                                        <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Notes<textarea name={`sourceConfig:${source.value}:notes`} defaultValue={sourceSettings?.notes ?? ""} rows={2} placeholder={source.notesPlaceholder} className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-neutral-600" /></label>
                                    </div>
                                </details>
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
