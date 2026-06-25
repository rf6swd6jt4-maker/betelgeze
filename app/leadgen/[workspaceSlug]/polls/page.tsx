import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { PollDuration } from "@/components/leadgen/PollDuration"
import { PollsAutoRefresh } from "@/components/leadgen/PollsAutoRefresh"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { sourceLabel } from "@/lib/leadgen/sources"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { cancelLeadgenPoll, createLeadgenPoll } from "../actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }
type PollStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

const statusStyles: Record<PollStatus, { label: string; mark: string; badge: string; row: string }> = {
    queued: { label: "Scheduled", mark: "bg-neutral-400", badge: "border-neutral-700 bg-neutral-800 text-neutral-200", row: "" },
    running: { label: "In progress", mark: "bg-yellow-300", badge: "border-yellow-300/30 bg-yellow-300/10 text-yellow-200", row: "bg-yellow-300/[0.03]" },
    completed: { label: "Successful", mark: "bg-emerald-300", badge: "border-emerald-300/30 bg-emerald-300/10 text-emerald-200", row: "" },
    failed: { label: "Failed", mark: "bg-red-300", badge: "border-red-300/30 bg-red-300/10 text-red-200", row: "" },
    cancelled: { label: "Cancelled", mark: "bg-red-300", badge: "border-red-300/30 bg-red-300/10 text-red-200", row: "" },
}

function statusMeta(status: string) {
    return statusStyles[(status as PollStatus) in statusStyles ? status as PollStatus : "queued"]
}

function sourceNames(snapshot: unknown, count: number) {
    if (!Array.isArray(snapshot) || snapshot.length === 0) return count ? `${count} configured` : "—"
    return snapshot
        .map((source) => {
            if (!source || typeof source !== "object" || !("key" in source)) return null
            const industries = "industries" in source && Array.isArray(source.industries) ? source.industries.length : 0
            const locations = "locations" in source && Array.isArray(source.locations) ? source.locations.length : 0
            const detail = [industries ? `${industries} industries` : null, locations ? `${locations} locations` : null].filter(Boolean).join(", ")
            return `${sourceLabel(String(source.key))}${detail ? ` (${detail})` : ""}`
        })
        .filter((label): label is string => Boolean(label))
        .join(", ") || `${count} configured`
}

export default async function LeadgenPollsPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    const pollsResult = await supabaseAdmin
        .from("leadgen_polls")
        .select("id, status, trigger, source_count, source_snapshot, candidate_count, normalised_count, deduped_count, enriched_count, qualified_count, created_at, started_at, completed_at, error")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(40)
    const polls = pollsResult.error ? [] : pollsResult.data ?? []
    const livePolls = polls.filter((poll) => ["queued", "running"].includes(poll.status))
    const latestPoll = polls[0]

    return <main className="min-h-screen bg-neutral-950 px-4 py-5 text-white sm:px-6 sm:py-6">
        <PollsAutoRefresh enabled={livePolls.length > 0} />
        <div className="mx-auto max-w-7xl">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
            <WorkspaceBanner bannerPath={workspace.leadgen_banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.leadgen_banner_height} position={workspace.leadgen_banner_position} />
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
                    <p className="mt-2 text-sm text-neutral-400">Track source polling, queue state, run durations, and pipeline counts. Signed in as {role}.</p>
                </div>
                <div className="flex w-full items-center justify-start gap-2 sm:w-auto sm:justify-end">
                    <form action={createLeadgenPoll.bind(null, workspace.slug)}>
                        <button className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3">New Poll</button>
                    </form>
                </div>
            </div>

            <LeadgenTabs workspaceSlug={workspace.slug} active="polls" />

            <div className="mt-5 grid gap-3 sm:grid-cols-4">
                {[
                    ["Running / scheduled", livePolls.length],
                    ["History", polls.length],
                    ["Latest candidates", latestPoll?.candidate_count ?? 0],
                    ["Latest qualified", latestPoll?.qualified_count ?? 0],
                ].map(([label, value]) => <div key={label} className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
                    <p className="text-xs text-neutral-500">{label}</p>
                    <p className="mt-1 text-lg font-semibold">{value}</p>
                </div>)}
            </div>

            <section className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900">
                <div className="flex flex-col gap-2 border-b border-neutral-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="font-semibold">Poll history</h2>
                        <p className="mt-1 text-sm text-neutral-500">Runs are processed one at a time. Extra manual polls stay scheduled until the active run finishes.</p>
                    </div>
                    {livePolls.length > 0 && <p className="text-xs text-neutral-500">Auto-refreshing every 5s</p>}
                </div>
                {polls.length ? <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] text-left text-sm">
                        <thead className="text-xs uppercase tracking-wide text-neutral-500">
                            <tr>
                                <th className="px-5 py-3 font-medium">Status</th>
                                <th className="px-5 py-3 font-medium">Started</th>
                                <th className="px-5 py-3 font-medium">Duration</th>
                                <th className="px-5 py-3 font-medium">Trigger</th>
                                <th className="px-5 py-3 font-medium">Source plan</th>
                                <th className="px-5 py-3 font-medium">Candidates</th>
                                <th className="px-5 py-3 font-medium">Normalised</th>
                                <th className="px-5 py-3 font-medium">Deduped</th>
                                <th className="px-5 py-3 font-medium">Enriched</th>
                                <th className="px-5 py-3 font-medium">Qualified</th>
                                <th className="px-5 py-3 font-medium">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {polls.map((poll) => {
                                const meta = statusMeta(poll.status)
                                const live = ["queued", "running"].includes(poll.status)
                                return <tr key={poll.id} className={`border-t border-neutral-800 ${meta.row}`}>
                                    <td className="px-5 py-3">
                                        <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${meta.badge}`}><BetelgezeStatusMark className={meta.mark} />{meta.label}</span>
                                        {poll.error && <p className="mt-1 max-w-48 truncate text-xs text-red-300">{poll.error}</p>}
                                    </td>
                                    <td className="px-5 py-3 text-neutral-300">{new Date(poll.started_at ?? poll.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</td>
                                    <td className="px-5 py-3 font-mono text-neutral-300"><PollDuration startedAt={poll.started_at} createdAt={poll.created_at} completedAt={poll.completed_at} live={live} /></td>
                                    <td className="px-5 py-3 capitalize text-neutral-400">{poll.trigger}</td>
                                    <td className="max-w-64 px-5 py-3 text-neutral-300"><span className="line-clamp-2">{sourceNames(poll.source_snapshot, poll.source_count)}</span></td>
                                    <td className="px-5 py-3 text-neutral-300">{poll.candidate_count}</td>
                                    <td className="px-5 py-3 text-neutral-300">{poll.normalised_count}</td>
                                    <td className="px-5 py-3 text-neutral-300">{poll.deduped_count}</td>
                                    <td className="px-5 py-3 text-neutral-300">{poll.enriched_count}</td>
                                    <td className="px-5 py-3 text-neutral-300">{poll.qualified_count}</td>
                                    <td className="px-5 py-3">{live ? <form action={cancelLeadgenPoll.bind(null, workspace.slug, poll.id)}><button className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/10">Cancel</button></form> : <span className="text-xs text-neutral-600">—</span>}</td>
                                </tr>
                            })}
                        </tbody>
                    </table>
                </div> : <div className="grid gap-4 p-5 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">No polls yet</p>
                        <h3 className="mt-3 text-xl font-semibold">Run your first test poll.</h3>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">This will queue a poll record. The source workers will later pick up scheduled polls and process sourcing, normalisation, dedupe, enrichment, validation, scoring, and routing.</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Status colours</p>
                        <ul className="mt-3 space-y-2 text-sm text-neutral-300">
                            <li className="flex items-center gap-2"><BetelgezeStatusMark className="bg-neutral-400" />Grey: scheduled or initialising.</li>
                            <li className="flex items-center gap-2"><BetelgezeStatusMark className="bg-yellow-300" />Yellow: in progress.</li>
                            <li className="flex items-center gap-2"><BetelgezeStatusMark className="bg-emerald-300" />Green: successful.</li>
                            <li className="flex items-center gap-2"><BetelgezeStatusMark className="bg-red-300" />Red: cancelled or failed.</li>
                        </ul>
                    </div>
                </div>}
            </section>
            <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
        </div>
    </main>
}
