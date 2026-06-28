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

export default async function LeadgenPollObjectPage({ params }: PageProps) {
    const { workspaceSlug, pollId } = await params
    const { workspace } = await requireWorkspace(workspaceSlug)
    const pollResult = await supabaseAdmin
        .from("leadgen_polls")
        .select("id, requested_by, status, trigger, source_count, source_snapshot, icp_snapshot, candidate_count, normalised_count, deduped_count, enriched_count, qualified_count, created_at, started_at, completed_at, error")
        .eq("workspace_id", workspace.id)
        .eq("id", pollId)
        .maybeSingle()
    if (pollResult.error || !pollResult.data) notFound()
    const poll = pollResult.data
    const [tasksResult, recordsResult, companiesResult, evidenceResult, investigationResult, claimsResult, scoresResult, catalogResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_poll_tasks")
            .select("id, source_key, stage, industry_value, location_value, status, source_query, raw_count, company_count, error, started_at, completed_at, created_at")
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
            .select("id, company_id, source_key, status, matched, skip_reason, error, owner_identity_points, owner_phone_points, business_support_points, created_at, completed_at")
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
    ])
    const tasks = tasksResult.error ? [] : tasksResult.data ?? []
    const records = recordsResult.error ? [] : recordsResult.data ?? []
    const companies = companiesResult.error ? [] : companiesResult.data ?? []
    const evidence = evidenceResult.error ? [] : evidenceResult.data ?? []
    const investigations = investigationResult.error ? [] : investigationResult.data ?? []
    const claims = claimsResult.error ? [] : claimsResult.data ?? []
    const scores = scoresResult.error ? [] : scoresResult.data ?? []
    const catalog = (catalogResult.error ? [] : catalogResult.data ?? []) as LeadgenSourceCatalogRow[]
    const sourcesByKey = sourceCatalogMap(catalog)
    const scoreByCompany = new Map(scores.map((score) => [score.company_id, score]))
    const processedTaskCount = tasks.filter((task) => ["completed", "failed"].includes(task.status)).length
    const rawReturnedCount = tasks.reduce((total, task) => total + (task.raw_count ?? 0), 0)
    const taskCompanyCount = tasks.reduce((total, task) => total + (task.company_count ?? 0), 0)
    const completedTaskCount = tasks.filter((task) => task.status === "completed").length
    const matchedInvestigationCount = investigations.filter((task) => task.matched).length
    const failedInvestigationCount = investigations.filter((task) => task.status === "failed" || task.error).length
    const skippedInvestigationCount = investigations.filter((task) => task.status === "skipped").length
    const ownerIdentityClaimCount = claims.filter((claim) => ["owner_identity", "officer_identity"].includes(claim.claim_kind)).length
    const ownerPhoneClaimCount = claims.filter((claim) => claim.claim_kind === "owner_phone").length
    const meta = statusMeta(poll.status)
    const live = ["queued", "running"].includes(poll.status)
    const consoleRows = [
        ...tasks.filter((task) => task.error).map((task) => ({ id: task.id, label: `${sourceHumanLabel(task.source_key, sourcesByKey, sourceLabel)}/${task.stage ?? "task"}`, error: task.error })),
        ...investigations.filter((task) => task.error).map((task) => ({ id: task.id, label: `${sourceHumanLabel(task.source_key, sourcesByKey, sourceLabel)}/candidate check`, error: task.error })),
    ].filter((row): row is { id: string; label: string; error: string } => Boolean(row.error))

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
                    ["Seed queries", `${completedTaskCount}/${tasks.length}`],
                    ["Raw returned", rawReturnedCount],
                    ["Candidate checks", `${matchedInvestigationCount}/${investigations.length}`],
                    ["Owner evidence", `${ownerIdentityClaimCount}/${ownerPhoneClaimCount}`],
                    ["Qualified", `${poll.qualified_count}`],
                ].map(([label, value]) => <div key={label} className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
                    <p className="text-xs text-neutral-500">{label}</p>
                    <p className="mt-1 text-lg font-semibold">{value}</p>
                </div>)}
            </section>

            <section className="mt-5 grid gap-3 lg:grid-cols-3">
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Fan-out status</p>
                    <p className="mt-2 text-sm text-neutral-300">{investigations.length} candidate-level checks generated; {matchedInvestigationCount} matched, {skippedInvestigationCount} skipped, {failedInvestigationCount} failed.</p>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Qualification rule</p>
                    <p className="mt-2 text-sm text-neutral-300">A lead only qualifies when owner identity and owner phone evidence both clear the score threshold.</p>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Stored candidates</p>
                    <p className="mt-2 text-sm text-neutral-300">{companies.length || poll.normalised_count} companies were stored for audit, even if they did not qualify for the Leads tab.</p>
                </div>
            </section>

            <section className="mt-5 rounded-2xl border border-neutral-800 bg-black">
                <div className="border-b border-neutral-800 px-5 py-4">
                    <h2 className="font-semibold">Candidate investigations</h2>
                    <p className="mt-1 text-sm text-neutral-500">One candidate can be checked against many free/public sources. Planned adapters are skipped loudly until implemented.</p>
                    <p className="mt-2 text-xs text-neutral-600">{investigations.length} source checks · {claims.length} normalized evidence claims</p>
                </div>
                {investigations.length ? investigations.map((task) => {
                    const taskMeta = statusMeta(task.status === "skipped" ? "queued" : task.status)
                    return <details key={task.id} className="border-b border-neutral-900 px-4 py-3 last:border-0">
                        <summary className="grid cursor-pointer gap-3 md:grid-cols-[150px_minmax(180px,1fr)_100px_140px_minmax(0,1fr)] md:items-center">
                            <span className={`inline-flex items-center gap-2 text-sm ${task.status === "skipped" ? "text-neutral-500" : taskMeta.text}`}><BetelgezeStatusMark className={task.status === "skipped" ? "bg-neutral-600" : taskMeta.mark} />{task.status}</span>
                            <span className="truncate text-sm text-neutral-300">{sourceHumanLabel(task.source_key, sourcesByKey, sourceLabel)}</span>
                            <span className="text-sm text-neutral-500">{task.matched ? "matched" : "no match"}</span>
                            <span className="text-sm text-neutral-500">{task.owner_identity_points}/{task.owner_phone_points}/{task.business_support_points} pts</span>
                            <span className="truncate text-sm text-neutral-500">{task.error ?? task.skip_reason ?? "—"}</span>
                        </summary>
                        <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">{jsonPreview(task)}</pre>
                    </details>
                }) : <p className="p-5 text-sm text-neutral-500">No candidate investigation tasks were generated.</p>}
            </section>

            {(poll.error || consoleRows.length > 0) && <section className="mt-5 rounded-2xl border border-red-400/20 bg-red-950/[0.08] p-5">
                <h2 className="font-semibold text-red-200">Console</h2>
                {poll.error && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-red-100">{poll.error}</p>}
                <div className="mt-3 space-y-2">
                    {consoleRows.map((row) => <p key={row.id} className="whitespace-pre-wrap break-words rounded-lg border border-red-400/20 bg-black/30 p-3 text-xs text-red-100">{row.label}: {row.error}</p>)}
                </div>
            </section>}

            <section className="mt-5 rounded-2xl border border-neutral-800 bg-black">
                <div className="border-b border-neutral-800 px-5 py-4">
                    <h2 className="font-semibold">Source tasks</h2>
                    <p className="mt-1 text-sm text-neutral-500">Exact worker tasks generated for this poll. This is the truth layer for whether sources actually queried anything.</p>
                    <p className="mt-2 text-xs text-neutral-600">{tasks.length} generated · {processedTaskCount} processed · {rawReturnedCount} raw records returned · {taskCompanyCount} numbers returned from tasks</p>
                </div>
                {tasks.length ? tasks.map((task) => {
                    const taskMeta = statusMeta(task.status)
                    return <details key={task.id} className="border-b border-neutral-900 px-4 py-3 last:border-0">
                        <summary className="grid cursor-pointer gap-3 md:grid-cols-[150px_160px_120px_120px_minmax(0,1fr)] md:items-center">
                            <span className={`inline-flex items-center gap-2 text-sm ${taskMeta.text}`}><BetelgezeStatusMark className={taskMeta.mark} />{taskMeta.label}</span>
                            <span className="text-sm text-neutral-300">{sourceHumanLabel(task.source_key, sourcesByKey, sourceLabel)}</span>
                            <span className="text-sm text-neutral-500">{task.raw_count ?? 0} raw</span>
                            <span className="text-sm text-neutral-500">{task.company_count ?? 0} companies</span>
                            <span className="truncate text-sm text-neutral-500">{task.stage ?? "source query"}</span>
                        </summary>
                        <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">{jsonPreview(task.source_query)}</pre>
                    </details>
                }) : <p className="p-5 text-sm text-neutral-500">No tasks were generated.</p>}
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
                    </details>) : <p className="p-5 text-sm text-neutral-500">No enrichment evidence stored.</p>}
                </div>
            </section>
        </div>
    </main>
}
