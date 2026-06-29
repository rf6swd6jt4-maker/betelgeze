import Link from "next/link"
import { notFound } from "next/navigation"
import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { BrandLockup } from "@/components/brand/BrandLockup"
import { PollDuration } from "@/components/leadgen/PollDuration"
import { sourceCatalogMap, sourceHumanLabel, type LeadgenSourceCatalogRow } from "@/lib/leadgen/source-catalog-ui"
import { sourceLabel } from "@/lib/leadgen/sources"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string; pollId: string }> }

const statusStyles: Record<string, { label: string; mark: string; text: string }> = {
    queued: { label: "Initialising", mark: "bg-neutral-400", text: "text-neutral-300" },
    running: { label: "In progress", mark: "bg-yellow-300", text: "text-yellow-200" },
    completed: { label: "Completed", mark: "bg-emerald-300", text: "text-emerald-200" },
    failed: { label: "Failed", mark: "bg-red-300", text: "text-red-200" },
    cancelled: { label: "Cancelled", mark: "bg-red-300", text: "text-red-200" },
}

function statusMeta(status: string) {
    return statusStyles[status] ?? statusStyles.queued
}

function jsonPreview(value: unknown) {
    return JSON.stringify(value ?? {}, null, 2)
}

function sourceNames(snapshot: unknown, count: number) {
    if (!Array.isArray(snapshot) || snapshot.length === 0) return count ? `${count} configured sources` : "No source snapshot"
    return snapshot
        .map((source) => source && typeof source === "object" && "key" in source ? sourceLabel(String(source.key)) : null)
        .filter((value): value is string => Boolean(value))
        .join(", ")
}

const stageDefinitions = [
    {
        key: "seed",
        title: "Seed businesses",
        detail: "Seed sources collect the backup pool of candidate businesses.",
        passedLabel: "seeded",
    },
    {
        key: "business_validation",
        title: "Business validation",
        detail: "The seed pool is validated as a batch; failed businesses are replaced by backup seed candidates until the target set is filled.",
        passedLabel: "validated",
    },
    {
        key: "owner_identity",
        title: "Owner identity",
        detail: "The validated batch is checked for a credible owner, principal, or authorised official name.",
        passedLabel: "owners",
    },
    {
        key: "owner_phone",
        title: "Owner phone discovery",
        detail: "Only businesses with owner identity evidence move into owner phone discovery.",
        passedLabel: "numbers",
    },
    {
        key: "phone_validation",
        title: "Phone validation",
        detail: "Discovered owner numbers are checked for callable formatting now; line-type/mobile validation can replace this later.",
        passedLabel: "callable",
    },
] as const

type StageKey = typeof stageDefinitions[number]["key"]

function normalisedStageKey(value: unknown): StageKey | null {
    return stageDefinitions.some((stage) => stage.key === value) ? value as StageKey : null
}

function taskStageKey(task: { stage_key?: string | null; stage?: string | null; source_key?: string | null }) {
    const explicit = normalisedStageKey(task.stage_key)
    if (explicit) return explicit
    if (["overture", "osm", "alltheplaces", "foursquare_os_places"].includes(task.source_key ?? "") || task.stage === "candidate_seed") return "seed"
    if (task.stage === "phone_validation") return "phone_validation"
    return "business_validation"
}

function investigationStageKey(task: { stage_key?: string | null }) {
    return normalisedStageKey(task.stage_key) ?? "business_validation"
}

function formatDuration(startedAt: string | null | undefined, completedAt: string | null | undefined) {
    if (!startedAt) return "Not started"
    const end = completedAt ? new Date(completedAt).getTime() : Date.now()
    const start = new Date(startedAt).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "Running"
    const seconds = Math.max(0, Math.round((end - start) / 1000))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

export default async function LeadgenPollObjectPage({ params }: PageProps) {
    const { workspaceSlug, pollId } = await params
    const { workspace } = await requireWorkspace(workspaceSlug)
    const pollResult = await supabaseAdmin
        .from("leadgen_polls")
        .select("id, requested_by, status, trigger, source_count, source_snapshot, icp_snapshot, candidate_count, normalised_count, deduped_count, enriched_count, qualified_count, current_stage, target_validated_count, max_seed_candidates, seeded_count, validation_passed_count, owner_identity_count, owner_phone_count, callable_phone_count, stage_summary, created_at, started_at, completed_at, error")
        .eq("workspace_id", workspace.id)
        .eq("id", pollId)
        .maybeSingle()
    if (pollResult.error || !pollResult.data) notFound()
    const poll = pollResult.data
    const [tasksResult, recordsResult, companiesResult, evidenceResult, investigationResult, claimsResult, scoresResult, catalogResult, stageRunsResult, companyStagesResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_poll_tasks")
            .select("id, source_key, stage_key, stage, industry_value, location_value, status, source_query, raw_count, company_count, error, started_at, completed_at, created_at")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: true }),
        supabaseAdmin
            .from("leadgen_source_records")
            .select("id, source_key, source_record_id, company_name, phone, website_url, profile_url, address, categories, raw_payload, created_at")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(200),
        supabaseAdmin
            .from("leadgen_companies")
            .select("id, display_name, phone, owner_name, owner_phone, owner_source_key, website_url, profile_url, source_key, source_record_id, industry_value, location_value, address, owner_evidence, owner_identity_points, owner_phone_points, business_support_points, lead_score, qualification_status, disqualification_reason, created_at")
            .eq("first_seen_poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(200),
        supabaseAdmin
            .from("leadgen_evidence")
            .select("id, source_key, evidence_kind, confidence, value, raw_payload, company_id, created_at")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(200),
        supabaseAdmin
            .from("leadgen_investigation_tasks")
            .select("id, company_id, stage_key, source_key, status, matched, skip_reason, error, owner_identity_points, owner_phone_points, business_support_points, created_at, completed_at")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: true })
            .limit(500),
        supabaseAdmin
            .from("leadgen_evidence_claims")
            .select("id, company_id, source_key, claim_kind, points_awarded, confidence, claim_value, provenance_url, created_at")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(500),
        supabaseAdmin
            .from("leadgen_candidate_scores")
            .select("company_id, owner_identity_points, owner_phone_points, business_support_points, total_score, qualification_status, disqualification_reason, best_owner_name, best_owner_phone")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id),
        supabaseAdmin
            .from("leadgen_source_catalog")
            .select("source_key, label, family, source_points, owner_identity_points, owner_phone_points, business_support_points, access_method, free_status, implementation_status, run_stage, enabled, rate_limit_ms, coverage, metadata"),
        supabaseAdmin
            .from("leadgen_poll_stage_runs")
            .select("id, stage_key, stage_order, status, target_count, input_count, passed_count, failed_count, skipped_count, replaced_count, error, metrics, started_at, completed_at, created_at")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("stage_order", { ascending: true }),
        supabaseAdmin
            .from("leadgen_company_stage_status")
            .select("id, company_id, stage_key, status, source_keys, score, reason, metrics, completed_at")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: true })
            .limit(1000),
    ])
    const tasks = tasksResult.error ? [] : tasksResult.data ?? []
    const records = recordsResult.error ? [] : recordsResult.data ?? []
    const companies = companiesResult.error ? [] : companiesResult.data ?? []
    const evidence = evidenceResult.error ? [] : evidenceResult.data ?? []
    const investigations = investigationResult.error ? [] : investigationResult.data ?? []
    const claims = claimsResult.error ? [] : claimsResult.data ?? []
    const scores = scoresResult.error ? [] : scoresResult.data ?? []
    const catalog = (catalogResult.error ? [] : catalogResult.data ?? []) as LeadgenSourceCatalogRow[]
    const stageRuns = stageRunsResult.error ? [] : stageRunsResult.data ?? []
    const companyStages = companyStagesResult.error ? [] : companyStagesResult.data ?? []
    const sourcesByKey = sourceCatalogMap(catalog)
    const scoreByCompany = new Map(scores.map((score) => [score.company_id, score]))
    const ownerIdentityClaimCount = claims.filter((claim) => ["owner_identity", "officer_identity"].includes(claim.claim_kind)).length
    const ownerPhoneClaimCount = claims.filter((claim) => claim.claim_kind === "owner_phone").length
    const meta = statusMeta(poll.status)
    const live = ["queued", "running"].includes(poll.status)
    const consoleRows = [
        ...tasks.filter((task) => task.error).map((task) => ({ id: task.id, label: `${sourceHumanLabel(task.source_key, sourcesByKey, sourceLabel)}/${task.stage ?? "task"}`, error: task.error })),
        ...investigations.filter((task) => task.error).map((task) => ({ id: task.id, label: `${sourceHumanLabel(task.source_key, sourcesByKey, sourceLabel)}/candidate check`, error: task.error })),
    ].filter((row): row is { id: string; label: string; error: string } => Boolean(row.error))
    const stageRunsByKey = new Map(stageRuns.map((stage) => [stage.stage_key, stage]))
    const sourceTasksByStage = new Map<StageKey, typeof tasks>()
    const investigationTasksByStage = new Map<StageKey, typeof investigations>()
    const companyStagesByStage = new Map<StageKey, typeof companyStages>()
    for (const stage of stageDefinitions) {
        sourceTasksByStage.set(stage.key, tasks.filter((task) => taskStageKey(task) === stage.key))
        investigationTasksByStage.set(stage.key, investigations.filter((task) => investigationStageKey(task) === stage.key))
        companyStagesByStage.set(stage.key, companyStages.filter((item) => normalisedStageKey(item.stage_key) === stage.key))
    }
    const stageMetrics = {
        seed: poll.seeded_count ?? stageRunsByKey.get("seed")?.passed_count ?? companies.length,
        business_validation: poll.validation_passed_count ?? stageRunsByKey.get("business_validation")?.passed_count ?? 0,
        owner_identity: poll.owner_identity_count ?? stageRunsByKey.get("owner_identity")?.passed_count ?? ownerIdentityClaimCount,
        owner_phone: poll.owner_phone_count ?? stageRunsByKey.get("owner_phone")?.passed_count ?? ownerPhoneClaimCount,
        phone_validation: poll.callable_phone_count ?? stageRunsByKey.get("phone_validation")?.passed_count ?? poll.qualified_count,
    }

    return <main className="min-h-screen bg-neutral-950 px-5 py-8 text-white sm:px-8">
        <div className="mx-auto max-w-6xl">
            <header className="flex flex-col justify-between gap-5 border-b border-neutral-800 pb-6 sm:flex-row sm:items-center">
                <div>
                    <BrandLockup href={`https://leadgen.betelgeze.com/${workspace.slug}`} />
                    <div className="mt-5 flex flex-wrap gap-4 text-sm text-neutral-400">
                        <Link href={`https://leadgen.betelgeze.com/${workspace.slug}/polls`}>← Poll history</Link>
                        <Link href={`https://leadgen.betelgeze.com/${workspace.slug}`}>Leads</Link>
                        <Link href={`https://leadgen.betelgeze.com/${workspace.slug}/new`}>New poll</Link>
                    </div>
                </div>
                <p className="text-sm text-neutral-500">{workspace.name}</p>
            </header>

            <section className="py-10">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Poll detail</p>
                        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Poll {shortId(poll.id)}</h1>
                        <p className="mt-3 text-sm text-neutral-400">{sourceNames(poll.source_snapshot, poll.source_count)} · {formatRelativeTime(poll.created_at)}</p>
                    </div>
                    <div className={`inline-flex items-center gap-3 ${meta.text}`}>
                        <BetelgezeStatusMark className={meta.mark} />
                        <span>{meta.label}</span>
                        <span className="font-mono text-sm text-neutral-500"><PollDuration startedAt={poll.started_at} createdAt={poll.created_at} completedAt={poll.completed_at} live={live} /></span>
                    </div>
                </div>
            </section>

            <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {[
                    ["Seeded", stageMetrics.seed],
                    ["Validated", stageMetrics.business_validation],
                    ["Owner identified", stageMetrics.owner_identity],
                    ["Owner numbers", stageMetrics.owner_phone],
                    ["Callable", stageMetrics.phone_validation],
                ].map(([label, value]) => <div key={label} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                    <p className="text-xs text-neutral-500">{label}</p>
                    <p className="mt-1 text-lg font-semibold">{value}</p>
                </div>)}
            </section>

            <section className="mt-5 rounded-2xl border border-neutral-800 bg-black">
                <div className="border-b border-neutral-800 px-5 py-4">
                    <h2 className="font-semibold">Poll funnel</h2>
                    <p className="mt-1 text-sm text-neutral-500">Each step runs against the whole current batch before the next step starts. The counts below are the handoff counts between stages.</p>
                    <p className="mt-2 text-xs text-neutral-600">{tasks.length} source tasks · {investigations.length} candidate checks · {claims.length} evidence claims</p>
                </div>
                <div className="divide-y divide-neutral-900">
                    {stageDefinitions.map((stage, index) => {
                        const run = stageRunsByKey.get(stage.key)
                        const sourceTasks = sourceTasksByStage.get(stage.key) ?? []
                        const investigationTasks = investigationTasksByStage.get(stage.key) ?? []
                        const companyRows = companyStagesByStage.get(stage.key) ?? []
                        const runStatus = run?.status ?? (poll.current_stage === stage.key ? "running" : index === 0 && tasks.length ? "completed" : "queued")
                        const runMeta = statusMeta(runStatus === "skipped" ? "queued" : runStatus)
                        const passed = run?.passed_count ?? stageMetrics[stage.key]
                        const input = run?.input_count ?? (stage.key === "seed" ? run?.target_count ?? poll.max_seed_candidates ?? 0 : 0)
                        const failed = run?.failed_count ?? 0
                        const skipped = run?.skipped_count ?? 0
                        return <details key={stage.key} open={index < 3 || runStatus === "running"} className="group">
                            <summary className="grid cursor-pointer gap-3 px-4 py-4 sm:grid-cols-[34px_minmax(0,1fr)_auto] sm:items-start sm:px-5">
                                <span className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg border ${runStatus === "completed" ? "border-emerald-400/30 bg-emerald-300/10 text-emerald-200" : runStatus === "running" ? "border-yellow-400/30 bg-yellow-300/10 text-yellow-200" : runStatus === "failed" ? "border-red-400/30 bg-red-300/10 text-red-200" : "border-neutral-800 bg-neutral-950 text-neutral-500"}`}>{index + 1}</span>
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                        <h3 className="text-sm font-semibold leading-5 text-white">{stage.title}</h3>
                                        <span className={`inline-flex items-center gap-2 text-xs ${runStatus === "skipped" ? "text-neutral-500" : runMeta.text}`}><BetelgezeStatusMark className={runStatus === "skipped" ? "bg-neutral-600" : runMeta.mark} />{runStatus}</span>
                                    </div>
                                    <p className="mt-1 text-sm leading-5 text-neutral-500">{stage.detail}</p>
                                    {run?.error ? <p className="mt-2 text-xs leading-5 text-red-200">{run.error}</p> : null}
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-right sm:min-w-[290px]">
                                    <div>
                                        <p className="text-lg font-semibold leading-6 text-white">{passed}</p>
                                        <p className="text-[11px] uppercase tracking-wide text-neutral-600">{stage.passedLabel}</p>
                                    </div>
                                    <div>
                                        <p className="text-lg font-semibold leading-6 text-neutral-200">{input}</p>
                                        <p className="text-[11px] uppercase tracking-wide text-neutral-600">input</p>
                                    </div>
                                    <div>
                                        <p className="text-lg font-semibold leading-6 text-neutral-200">{formatDuration(run?.started_at, run?.completed_at)}</p>
                                        <p className="text-[11px] uppercase tracking-wide text-neutral-600">time</p>
                                    </div>
                                </div>
                            </summary>
                            <div className="border-t border-neutral-900 bg-neutral-950/40 px-4 py-3 sm:px-5">
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
                                    <span>{failed} failed</span>
                                    <span>{skipped} skipped</span>
                                    <span>{run?.replaced_count ?? 0} replaced or held back</span>
                                    <span>{sourceTasks.length + investigationTasks.length} tasks</span>
                                    <span>{companyRows.length} company results</span>
                                </div>
                                <div className="mt-3 space-y-2">
                                    {sourceTasks.map((task) => {
                                        const taskMeta = statusMeta(task.status)
                                        return <details key={task.id} className="rounded-lg border border-neutral-800 bg-black px-3 py-2">
                                            <summary className="grid cursor-pointer gap-2 text-sm sm:grid-cols-[130px_minmax(0,1fr)_90px_90px_minmax(0,1fr)] sm:items-center">
                                                <span className={`inline-flex items-center gap-2 ${taskMeta.text}`}><BetelgezeStatusMark className={taskMeta.mark} />{taskMeta.label}</span>
                                                <span className="truncate text-neutral-200">{sourceHumanLabel(task.source_key, sourcesByKey, sourceLabel)}</span>
                                                <span className="text-neutral-500">{task.raw_count ?? 0} raw</span>
                                                <span className="text-neutral-500">{task.company_count ?? 0} numbers</span>
                                                <span className="truncate text-neutral-500">{task.stage ?? "source task"}</span>
                                            </summary>
                                            <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">{jsonPreview(task.source_query)}</pre>
                                        </details>
                                    })}
                                    {investigationTasks.map((task) => {
                                        const taskMeta = statusMeta(task.status === "skipped" ? "queued" : task.status)
                                        return <details key={task.id} className="rounded-lg border border-neutral-800 bg-black px-3 py-2">
                                            <summary className="grid cursor-pointer gap-2 text-sm sm:grid-cols-[130px_minmax(0,1fr)_90px_120px_minmax(0,1fr)] sm:items-center">
                                                <span className={`inline-flex items-center gap-2 ${task.status === "skipped" ? "text-neutral-500" : taskMeta.text}`}><BetelgezeStatusMark className={task.status === "skipped" ? "bg-neutral-600" : taskMeta.mark} />{task.status}</span>
                                                <span className="truncate text-neutral-200">{sourceHumanLabel(task.source_key, sourcesByKey, sourceLabel)}</span>
                                                <span className="text-neutral-500">{task.matched ? "matched" : "no match"}</span>
                                                <span className="text-neutral-500">{task.owner_identity_points}/{task.owner_phone_points}/{task.business_support_points} pts</span>
                                                <span className="truncate text-neutral-500">{task.error ?? task.skip_reason ?? "candidate check"}</span>
                                            </summary>
                                            <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">{jsonPreview(task)}</pre>
                                        </details>
                                    })}
                                    {companyRows.slice(0, 12).map((row) => {
                                        const rowMeta = row.status === "passed" ? { mark: "bg-emerald-300", text: "text-emerald-200" } : row.status === "failed" ? { mark: "bg-red-300", text: "text-red-200" } : { mark: "bg-neutral-600", text: "text-neutral-500" }
                                        return <details key={row.id} className="rounded-lg border border-neutral-800 bg-black px-3 py-2">
                                            <summary className="grid cursor-pointer gap-2 text-sm sm:grid-cols-[130px_minmax(0,1fr)_80px_minmax(0,1fr)] sm:items-center">
                                                <span className={`inline-flex items-center gap-2 ${rowMeta.text}`}><BetelgezeStatusMark className={rowMeta.mark} />{row.status}</span>
                                                <span className="truncate text-neutral-200">{shortId(row.company_id)}</span>
                                                <span className="text-neutral-500">{row.score ?? 0} pts</span>
                                                <span className="truncate text-neutral-500">{row.reason ?? "stage result"}</span>
                                            </summary>
                                            <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">{jsonPreview(row)}</pre>
                                        </details>
                                    })}
                                    {sourceTasks.length === 0 && investigationTasks.length === 0 && companyRows.length === 0 ? <p className="rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm text-neutral-500">No task rows recorded for this stage yet.</p> : null}
                                </div>
                            </div>
                        </details>
                    })}
                </div>
            </section>

            <section className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                <h2 className="font-semibold">Console</h2>
                {poll.error ? <p className="mt-3 whitespace-pre-wrap break-words text-sm text-red-100">{poll.error}</p> : null}
                <div className="mt-3 space-y-2">
                    {consoleRows.length ? consoleRows.map((row) => <p key={row.id} className="whitespace-pre-wrap break-words rounded-lg border border-red-400/20 bg-black/30 p-3 text-xs text-red-100">{row.label}: {row.error}</p>) : <p className="rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm text-neutral-500">No poll errors logged.</p>}
                </div>
            </section>

            <section className="mt-5 rounded-2xl border border-neutral-800 bg-black">
                <div className="border-b border-neutral-800 px-5 py-4">
                    <h2 className="font-semibold">Companies returned</h2>
                    <p className="mt-1 text-sm text-neutral-500">Normalised companies from this poll, including owner and phone fields.</p>
                </div>
                {companies.length ? companies.map((company) => <details key={company.id} className="border-b border-neutral-900 px-4 py-3 last:border-0">
                    <summary className="grid cursor-pointer gap-3 md:grid-cols-[minmax(180px,1fr)_170px_170px_130px_120px] md:items-center">
                        <span className="truncate text-sm font-medium text-neutral-100">{company.display_name}</span>
                        <span className="truncate text-sm text-neutral-300">{company.owner_name ? `Owner: ${company.owner_name}` : "No owner"}</span>
                        <span className="truncate text-sm text-neutral-300">{company.owner_phone ?? "No owner phone"}</span>
                        <span className="truncate text-sm text-neutral-500">{scoreByCompany.get(company.id)?.qualification_status ?? company.qualification_status} · {scoreByCompany.get(company.id)?.total_score ?? company.lead_score ?? 0} pts</span>
                        <span className="font-mono text-xs text-neutral-500">{shortId(company.id)}</span>
                    </summary>
                    <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">{jsonPreview(company)}</pre>
                </details>) : <p className="p-5 text-sm text-neutral-500">No companies were normalised.</p>}
            </section>

            <section className="mt-5 grid gap-5 lg:grid-cols-2">
                <div className="rounded-2xl border border-neutral-800 bg-black">
                    <div className="border-b border-neutral-800 px-5 py-4">
                        <h2 className="font-semibold">Raw source records</h2>
                    </div>
                    {records.length ? records.map((record) => <details key={record.id} className="border-b border-neutral-900 px-4 py-3 last:border-0">
                        <summary className="cursor-pointer text-sm text-neutral-200">{record.company_name} <span className="ml-2 text-neutral-500">{record.phone ?? "no phone"}</span></summary>
                        <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">{jsonPreview(record)}</pre>
                    </details>) : <p className="p-5 text-sm text-neutral-500">No raw source records stored.</p>}
                </div>
                <div className="rounded-2xl border border-neutral-800 bg-black">
                    <div className="border-b border-neutral-800 px-5 py-4">
                        <h2 className="font-semibold">Evidence claims</h2>
                    </div>
                    {claims.length ? claims.map((item) => <details key={item.id} className="border-b border-neutral-900 px-4 py-3 last:border-0">
                        <summary className="cursor-pointer text-sm text-neutral-200">{item.claim_kind} <span className="ml-2 text-neutral-500">{sourceHumanLabel(item.source_key, sourcesByKey, sourceLabel)} · {item.points_awarded} pts · {item.confidence ?? "—"}%</span></summary>
                        <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">{jsonPreview(item)}</pre>
                    </details>) : evidence.length ? evidence.map((item) => <details key={item.id} className="border-b border-neutral-900 px-4 py-3 last:border-0">
                        <summary className="cursor-pointer text-sm text-neutral-200">{item.evidence_kind} <span className="ml-2 text-neutral-500">{sourceHumanLabel(item.source_key, sourcesByKey, sourceLabel)} · {item.confidence ?? "—"}%</span></summary>
                        <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">{jsonPreview(item)}</pre>
                    </details>) : <p className="p-5 text-sm text-neutral-500">No source evidence stored.</p>}
                </div>
            </section>
        </div>
    </main>
}
