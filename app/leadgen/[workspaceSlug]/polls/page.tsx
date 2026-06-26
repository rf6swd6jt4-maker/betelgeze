import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { NewPollButton } from "@/components/leadgen/NewPollButton"
import { PollDuration } from "@/components/leadgen/PollDuration"
import { PollsAutoRefresh } from "@/components/leadgen/PollsAutoRefresh"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListCreatorAvatar } from "@/components/list/ListCreatorAvatar"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { MobileCardActionSurface } from "@/components/list/MobileCardActionSurface"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { sourceLabel } from "@/lib/leadgen/sources"
import { createUploadSignedUrls } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { compactText, formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import Link from "next/link"
import { cancelLeadgenPoll, removeLeadgenPoll, retryLeadgenPoll } from "../actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }
type PollStatus = "queued" | "running" | "completed" | "failed" | "cancelled"
type PollTask = {
    id: string
    poll_id: string
    status: string
    source_key: string
    industry_value: string | null
    location_value: string | null
    raw_count: number | null
    company_count: number | null
    error: string | null
    created_at: string
}

const statusStyles: Record<PollStatus, { label: string; mark: string; text: string }> = {
    queued: { label: "Initialising", mark: "bg-neutral-400", text: "text-neutral-300" },
    running: { label: "In progress", mark: "bg-yellow-300", text: "text-yellow-200" },
    completed: { label: "Successful", mark: "bg-emerald-300", text: "text-emerald-200" },
    failed: { label: "Failed", mark: "bg-red-300", text: "text-red-200" },
    cancelled: { label: "Cancelled", mark: "bg-red-300", text: "text-red-200" },
}

function statusMeta(status: string) {
    return statusStyles[(status as PollStatus) in statusStyles ? status as PollStatus : "queued"]
}

function sourceNames(snapshot: unknown, count: number) {
    if (!Array.isArray(snapshot) || snapshot.length === 0) return count ? `${count} configured` : "Source"
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
        .select("id, requested_by, status, trigger, source_count, source_snapshot, candidate_count, normalised_count, deduped_count, enriched_count, qualified_count, created_at, started_at, completed_at, error")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(40)
    const polls = pollsResult.error ? [] : pollsResult.data ?? []
    const creatorIds = [...new Set(polls.map((poll) => poll.requested_by).filter(Boolean))] as string[]
    const { data: creators } = creatorIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", creatorIds)
        : { data: [] as Array<{ user_id: string; username: string; avatar_path: string | null }> }
    const creatorById = new Map((creators ?? []).map((creator) => [creator.user_id, creator]))
    const creatorAvatarUrls = await createUploadSignedUrls((creators ?? []).map((creator) => creator.avatar_path).filter((path): path is string => Boolean(path)))

    const tasksResult = polls.length ? await supabaseAdmin
        .from("leadgen_poll_tasks")
        .select("id, poll_id, status, source_key, industry_value, location_value, raw_count, company_count, error, created_at")
        .in("poll_id", polls.map((poll) => poll.id))
        .order("created_at", { ascending: true }) : { data: [], error: null }
    const pollTasks = (tasksResult.error ? [] : tasksResult.data ?? []) as PollTask[]
    const tasksByPoll = pollTasks.reduce<Record<string, PollTask[]>>((groups, task) => {
        groups[task.poll_id] = [...(groups[task.poll_id] ?? []), task]
        return groups
    }, {})
    const livePolls = polls.filter((poll) => ["queued", "running"].includes(poll.status))
    const latestPoll = polls[0]

    return <main className="min-h-screen bg-neutral-950 px-4 py-5 text-white sm:px-6 sm:py-6">
        <PollsAutoRefresh enabled intervalMs={5000} />
        <div className="mx-auto max-w-7xl">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
            <WorkspaceBanner bannerPath={workspace.leadgen_banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.leadgen_banner_height} position={workspace.leadgen_banner_position} />
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
                    <p className="mt-2 text-sm text-neutral-400">Track source polling, queue state, run durations, and pipeline counts. Signed in as {role}.</p>
                </div>
                <NewPollButton href={`https://leadgen.betelgeze.com/${workspace.slug}/polls/new`} />
            </div>

            <LeadgenTabs workspaceSlug={workspace.slug} active="polls" />

            <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 sm:grid-cols-4 sm:gap-3 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent">
                {[
                    ["Running", livePolls.length, ""],
                    ["History", polls.length, ""],
                    ["Latest searched", latestPoll?.candidate_count ?? 0, "hidden sm:block"],
                    ["Returned", latestPoll?.normalised_count ?? 0, ""],
                ].map(([label, value, className]) => <div key={label} className={`${className} border-r border-neutral-800 px-2 py-2 text-center last:border-r-0 sm:rounded-lg sm:border sm:border-neutral-800 sm:bg-neutral-900 sm:px-3 sm:text-left`}>
                    <p className="text-[10px] leading-tight text-neutral-500 sm:text-xs">{label}</p>
                    <p className="mt-1 text-lg font-semibold">{value}</p>
                </div>)}
            </div>

            <section className="mt-5 space-y-3 md:space-y-0 md:rounded-2xl md:border md:border-neutral-800 md:bg-black">
                {polls.length ? polls.map((poll) => {
                    const meta = statusMeta(poll.status)
                    const live = ["queued", "running"].includes(poll.status)
                    const tasks = tasksByPoll[poll.id] ?? []
                    const failedTasks = tasks.filter((task) => task.error || task.status === "failed")
                    const hasConsoleEntry = poll.status === "failed" || failedTasks.length > 0
                    const creator = poll.requested_by ? creatorById.get(poll.requested_by) : null
                    const statusMark = <span className={`inline-flex items-center gap-2 text-sm ${meta.text}`}><BetelgezeStatusMark className={meta.mark} />{meta.label}</span>
                    const duration = <span className="font-mono text-sm text-neutral-500"><PollDuration startedAt={poll.started_at} createdAt={poll.created_at} completedAt={poll.completed_at} live={live} /></span>
                    const triggerPill = <span className="w-fit rounded-md border border-neutral-800 px-2 py-1 text-[11px] uppercase tracking-wide text-neutral-400">{poll.trigger === "manual" ? "Manual" : "Automated"}</span>
                    const pollHref = `https://leadgen.betelgeze.com/${workspace.slug}/polls/${poll.id}`
                    const pollActions = [
                        { label: "Open poll", href: pollHref },
                        poll.status === "failed" ? { label: "Retry", action: retryLeadgenPoll.bind(null, workspace.slug, poll.id) } : {},
                        hasConsoleEntry ? { label: "Open console", href: `#poll-console-${poll.id}` } : {},
                        live ? { label: "Cancel", action: cancelLeadgenPoll.bind(null, workspace.slug, poll.id), danger: true, confirmMessage: "Cancel this running poll?" } : {},
                        { label: "Remove", action: removeLeadgenPoll.bind(null, workspace.slug, poll.id), danger: true },
                    ]
                    return <div key={poll.id} className="md:border-b md:border-neutral-900 md:last:border-0">
                        <MobileCardActionSurface actions={pollActions} className={`rounded-2xl border border-neutral-800 bg-black md:hidden ${poll.status === "failed" ? "bg-red-950/[0.08]" : ""}`}>
                            <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-neutral-900 bg-neutral-900/35 px-3.5 py-2.5">
                                <Link href={pollHref} className="min-w-0 truncate text-base font-medium text-neutral-100 underline decoration-neutral-500 underline-offset-4 hover:text-white">
                                    {sourceNames(poll.source_snapshot, poll.source_count)} poll
                                </Link>
                                <span className="flex shrink-0 items-center gap-2">{statusMark}{duration}</span>
                            </div>
                            <div className="flex items-center gap-3 px-3.5 py-2.5">
                                <p className="text-sm text-neutral-500"><span className="text-neutral-200">{poll.candidate_count}</span> searched</p>
                                <p className="text-sm text-neutral-500"><span className="text-neutral-200">{poll.normalised_count}</span> returned</p>
                                <p className="font-mono text-sm text-neutral-500">{shortId(poll.id)}</p>
                                <p className="ml-auto whitespace-nowrap text-sm text-neutral-500">{formatRelativeTime(poll.created_at)}</p>
                                <ListCreatorAvatar src={creator?.avatar_path ? creatorAvatarUrls.get(creator.avatar_path) : null} username={creator?.username ?? null} className="h-7 w-7 shrink-0" />
                            </div>
                        </MobileCardActionSurface>
                        <div className={`hidden min-h-14 gap-3 px-4 py-2.5 md:grid md:grid-cols-[minmax(190px,1fr)_94px_170px_160px_130px_100px_120px_32px] md:items-center ${poll.status === "failed" ? "bg-red-950/[0.08]" : ""}`}>
                        <div className="min-w-0">
                            <p className="truncate text-base font-medium text-neutral-100">{sourceNames(poll.source_snapshot, poll.source_count)} poll</p>
                        </div>
                        {triggerPill}
                        <div className="flex items-center justify-end gap-3 md:justify-start">
                            {statusMark}
                            {duration}
                        </div>
                        <p className="text-sm text-neutral-500"><span className="text-neutral-200">{poll.candidate_count}</span> records searched</p>
                        <p className="text-sm text-neutral-500"><span className="text-neutral-200">{poll.normalised_count}</span> returned</p>
                        <p className="font-mono text-sm text-neutral-500">{shortId(poll.id)}</p>
                        <div className="flex items-center justify-end gap-3">
                            <p className="whitespace-nowrap text-sm text-neutral-500">{formatRelativeTime(poll.created_at)}</p>
                            <ListCreatorBadge src={creator?.avatar_path ? creatorAvatarUrls.get(creator.avatar_path) : null} username={creator?.username ?? null} label="Created by" date={new Date(poll.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} />
                        </div>
                        <ListActionMenu actions={pollActions} />
                    </div>
                    </div>
                }) : <div className="p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">No polls yet</p>
                    <h3 className="mt-3 text-xl font-semibold">Run your first test poll.</h3>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">This will queue a poll record and run the configured sources.</p>
                </div>}
            </section>

            {polls.some((poll) => poll.status === "failed" || (tasksByPoll[poll.id] ?? []).some((task) => task.error || task.status === "failed")) && <section className="mt-5 rounded-2xl border border-neutral-800 bg-black">
                <div className="border-b border-neutral-800 px-5 py-4">
                    <h2 className="font-semibold">Poll console</h2>
                    <p className="mt-1 text-sm text-neutral-500">Open console from a failed poll to jump to its source errors.</p>
                </div>
                {polls.map((poll) => {
                    const failedTasks = (tasksByPoll[poll.id] ?? []).filter((task) => task.error || task.status === "failed")
                    if (poll.status !== "failed" && failedTasks.length === 0) return null
                    const firstError = poll.error ?? failedTasks.find((task) => task.error)?.error ?? "Poll failed without a task-level error. Retry the poll; if this repeats, the source worker could not create or read its source tasks."
                    const pollMeta = statusMeta(poll.status === "failed" ? "failed" : failedTasks[0]?.status ?? "failed")
                    return <div id={`poll-console-${poll.id}`} key={poll.id} className="grid min-h-14 scroll-mt-24 gap-3 border-b border-neutral-900 px-4 py-3 last:border-0 md:grid-cols-[140px_minmax(0,1fr)_120px] md:items-center">
                        <span className={`inline-flex items-center gap-2 text-sm ${pollMeta.text}`}><BetelgezeStatusMark className={pollMeta.mark} />{pollMeta.label}</span>
                        <details className="min-w-0 text-sm">
                            <summary className="cursor-pointer truncate text-red-300">{compactText(firstError, 220)}</summary>
                            <div className="mt-2 space-y-2">
                                {failedTasks.length ? failedTasks.map((task) => (
                                    <p key={task.id} className="whitespace-pre-wrap break-words rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-100">
                                        {task.error ?? `${task.source_key} task failed without a detailed error.`}
                                    </p>
                                )) : <p className="whitespace-pre-wrap break-words rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-100">{firstError}</p>}
                            </div>
                        </details>
                        <p className="font-mono text-xs text-neutral-500">{shortId(poll.id)}</p>
                    </div>
                })}
            </section>}
            <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
        </div>
    </main>
}
