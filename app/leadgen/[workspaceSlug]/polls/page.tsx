import { Avatar } from "@/components/account/Avatar"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { NewPollButton } from "@/components/leadgen/NewPollButton"
import { PollDuration } from "@/components/leadgen/PollDuration"
import { PollsAutoRefresh } from "@/components/leadgen/PollsAutoRefresh"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { buildSourcePlan, sourceLabel, type LeadgenSourceConfig } from "@/lib/leadgen/sources"
import { createUploadSignedUrls } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { compactText, formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import { cancelLeadgenPoll, createLeadgenPoll, removeLeadgenPoll, retryLeadgenPoll } from "../actions"

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
    queued: { label: "Scheduled", mark: "bg-neutral-400", text: "text-neutral-300" },
    running: { label: "In progress", mark: "bg-yellow-300", text: "text-yellow-200" },
    completed: { label: "Successful", mark: "bg-emerald-300", text: "text-emerald-200" },
    failed: { label: "Failed", mark: "bg-red-300", text: "text-red-200" },
    cancelled: { label: "Cancelled", mark: "bg-red-300", text: "text-red-200" },
}

function statusMeta(status: string) {
    return statusStyles[(status as PollStatus) in statusStyles ? status as PollStatus : "queued"]
}

function configObject(value: unknown): Partial<LeadgenSourceConfig> {
    return value && typeof value === "object" ? value as Partial<LeadgenSourceConfig> : {}
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
    const settingsResult = await supabaseAdmin
        .from("leadgen_workspace_settings")
        .select("enabled_sources, source_config")
        .eq("workspace_id", workspace.id)
        .maybeSingle()
    const settings = settingsResult.error ? null : settingsResult.data
    const enabledSources = Array.isArray(settings?.enabled_sources) ? settings.enabled_sources.map(String) : []
    const sourcePlan = buildSourcePlan(enabledSources, configObject(settings?.source_config))
    const runnableSourcePlan = sourcePlan.filter((source) => source.industries.length > 0 && source.locations.length > 0)
    const warnAboutOsmOnly = runnableSourcePlan.length === 1 && runnableSourcePlan[0]?.key === "osm"

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
                <form action={createLeadgenPoll.bind(null, workspace.slug)}>
                    <NewPollButton warnAboutOsmOnly={warnAboutOsmOnly} />
                </form>
            </div>

            <LeadgenTabs workspaceSlug={workspace.slug} active="polls" />

            <div className="mt-5 grid gap-3 sm:grid-cols-4">
                {[
                    ["Running / scheduled", livePolls.length],
                    ["History", polls.length],
                    ["Latest searched", latestPoll?.candidate_count ?? 0],
                    ["Latest returned", latestPoll?.normalised_count ?? 0],
                ].map(([label, value]) => <div key={label} className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
                    <p className="text-xs text-neutral-500">{label}</p>
                    <p className="mt-1 text-lg font-semibold">{value}</p>
                </div>)}
            </div>

            <section className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
                {polls.length ? polls.map((poll) => {
                    const meta = statusMeta(poll.status)
                    const live = ["queued", "running"].includes(poll.status)
                    const tasks = tasksByPoll[poll.id] ?? []
                    const failedTasks = tasks.filter((task) => task.error || task.status === "failed")
                    const creator = poll.requested_by ? creatorById.get(poll.requested_by) : null
                    return <div key={poll.id} className={`grid min-h-16 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-neutral-900 px-4 py-3 last:border-0 md:grid-cols-[minmax(240px,1.35fr)_170px_160px_130px_100px_120px_32px] md:items-center ${poll.status === "failed" ? "bg-red-950/[0.08]" : ""}`}>
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-neutral-100">{sourceNames(poll.source_snapshot, poll.source_count)} poll</p>
                            <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-neutral-500">
                                <Avatar src={creator?.avatar_path ? creatorAvatarUrls.get(creator.avatar_path) : null} name={creator?.username ?? "Betelgeze"} className="h-5 w-5 shrink-0" />
                                <span className="truncate">{creator ? `@${creator.username}` : "Betelgeze"}</span>
                                {poll.trigger !== "manual" && <span className="rounded-md border border-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">Automated</span>}
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-3 md:justify-start">
                            <span className={`inline-flex items-center gap-2 text-sm ${meta.text}`}><BetelgezeStatusMark className={meta.mark} />{meta.label}</span>
                            <span className="font-mono text-sm text-neutral-500"><PollDuration startedAt={poll.started_at} createdAt={poll.created_at} completedAt={poll.completed_at} live={live} /></span>
                        </div>
                        <p className="text-xs text-neutral-500 md:text-sm"><span className="text-neutral-200">{poll.candidate_count}</span> records searched</p>
                        <p className="text-xs text-neutral-500 md:text-sm"><span className="text-neutral-200">{poll.normalised_count}</span> returned</p>
                        <p className="font-mono text-xs text-neutral-500">{shortId(poll.id)}</p>
                        <p className="whitespace-nowrap text-xs text-neutral-500">{formatRelativeTime(poll.created_at)}</p>
                        <ListActionMenu actions={[
                            poll.status === "failed" ? { label: "Retry", action: retryLeadgenPoll.bind(null, workspace.slug, poll.id) } : {},
                            failedTasks.length ? { label: "Open console", href: `#poll-console-${poll.id}` } : {},
                            live ? { label: "Cancel", action: cancelLeadgenPoll.bind(null, workspace.slug, poll.id), danger: true, confirmMessage: "Cancel this running poll?" } : {},
                            { label: "Remove", action: removeLeadgenPoll.bind(null, workspace.slug, poll.id), danger: true },
                        ]} />
                    </div>
                }) : <div className="p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">No polls yet</p>
                    <h3 className="mt-3 text-xl font-semibold">Run your first test poll.</h3>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">This will queue a poll record and run the configured sources.</p>
                </div>}
            </section>

            {pollTasks.some((task) => task.error) && <section className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
                <div className="border-b border-neutral-800 px-5 py-4">
                    <h2 className="font-semibold">Poll console</h2>
                    <p className="mt-1 text-sm text-neutral-500">Open console from a failed poll to jump to its source errors.</p>
                </div>
                {polls.flatMap((poll) => (tasksByPoll[poll.id] ?? []).filter((task) => task.error).map((task) => {
                    const taskMeta = statusMeta(task.status)
                    return <div id={`poll-console-${poll.id}`} key={task.id} className="grid min-h-14 gap-3 border-b border-neutral-900 px-4 py-3 last:border-0 md:grid-cols-[140px_minmax(0,1fr)_120px] md:items-center">
                        <span className={`inline-flex items-center gap-2 text-sm ${taskMeta.text}`}><BetelgezeStatusMark className={taskMeta.mark} />{taskMeta.label}</span>
                        <details className="min-w-0 text-sm">
                            <summary className="cursor-pointer truncate text-red-300">{compactText(task.error, 220)}</summary>
                            <p className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-100">{task.error}</p>
                        </details>
                        <p className="font-mono text-xs text-neutral-500">{shortId(poll.id)}</p>
                    </div>
                }))}
            </section>}
            <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
        </div>
    </main>
}
