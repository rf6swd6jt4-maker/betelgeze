"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { List, ListCompactItem } from "@/components/list/List"
import { LoadingPulse } from "@/components/panel/PanelLoading"
import { Button, RoundPill, SegmentedSwitch, Status } from "@/components/ui"
import { nativePanelCacheKey, readNativePanel, type NativePanelSnapshot } from "@/components/workspace/NativeWorkspaceTab"
import { ATTENTION_LABELS, attentionHref, type AttentionGroup } from "@/lib/needs-attention"
import type { PersonalQueueSnapshot } from "@/lib/work-queue/server"
import { rankQueue } from "@/lib/work-queue/ranking"
import { dueLabel, effortLabel, waitingLabel } from "@/lib/today-column"
import { teamQueueRows, type TeamQueue } from "@/lib/team-queue"
import type { WorkspaceRecordCache } from "@/lib/workspace-record-cache"

const ATTENTION_REFRESH_MS = 60_000
const WIDE_QUERY = "(min-width: 1024px)"

/** True only where the Today column is shown (lg up), so a hidden column never mounts or fetches. */
export function useTodayColumnVisible(enabled: boolean) {
    return useSyncExternalStore(
        useCallback((notify: () => void) => {
            if (!enabled) return () => undefined
            const query = window.matchMedia(WIDE_QUERY)
            // resize as well as change: some environments resize without a media-query change event. React re-renders
            // only when the boolean snapshot flips, so this adds no render work while resizing.
            query.addEventListener("change", notify)
            window.addEventListener("resize", notify)
            return () => { query.removeEventListener("change", notify); window.removeEventListener("resize", notify) }
        }, [enabled]),
        () => enabled && window.matchMedia(WIDE_QUERY).matches,
        () => false,
    )
}
const QUEUE_ROWS = 12
const ATTENTION_ROWS = 4
const RECENT_ROWS = 5

/** Another destination that is still open in the shell; choosing it is a memory switch, not a load. */
export type TodayRecentDestination = { id: string; title: string; url: string }

type AttentionState = { status: "loading" } | { status: "ready"; groups: AttentionGroup[] } | { status: "unavailable" } | { status: "error"; message: string }

// Last good result per account and workspace, so reopening the phone sheet or remounting within a minute reuses it.
const attentionMemory = new Map<string, { state: AttentionState; at: number }>()

type TeamState = { status: "idle" } | { status: "loading" } | { status: "ready"; queue: TeamQueue } | { status: "unavailable" } | { status: "error"; message: string }
// Same reuse rule as Needs attention: the last good Team read per account and workspace, for one minute.
const teamMemory = new Map<string, { state: TeamState; at: number }>()
const QUEUE_SCOPES = [{ value: "mine", label: "Mine" }, { value: "team", label: "Team" }] as const

function pathOf(url: string) {
    try { return new URL(url, "http://workspace.invalid").pathname.replace(/\/$/, "") } catch { return url }
}

function readCollapsed(key: string) {
    try { return window.localStorage.getItem(key) === "1" } catch { return false }
}

function SectionHeading({ id, title, count, action }: { id: string; title: string; count?: ReactNode; action?: ReactNode }) {
    return <div className="mb-2 flex min-h-9 items-center gap-2 px-1">
        <h2 id={id} className="text-sm font-semibold text-neutral-100">{title}</h2>
        {count}
        {action ? <span className="ml-auto flex shrink-0 items-center">{action}</span> : null}
    </div>
}

/** Three quiet placeholder records while a section's first read is in flight. */
function LoadingRows({ label }: { label: string }) {
    return <List flush ariaLabel={label}>
        <div role="status" aria-label={label} className="divide-y divide-[var(--color-card-border)]">
            {[72, 56, 64].map(width => <div key={width} aria-hidden="true" className="flex flex-col gap-2 px-3.5 py-3">
                <LoadingPulse className="h-3 w-20" />
                <LoadingPulse className="h-4" style={{ width: `${width}%` }} />
            </div>)}
        </div>
    </List>
}

function Notice({ children, tone = "quiet" }: { children: ReactNode; tone?: "quiet" | "error" }) {
    return <p role={tone === "error" ? "alert" : undefined} className={`rounded-2xl border border-card-border bg-[var(--color-surface-1)] px-3.5 py-3 text-sm ${tone === "error" ? "text-red-200" : "text-neutral-400"}`}>{children}</p>
}

function Chevron({ open }: { open: boolean }) {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-neutral-400 ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
}

/**
 * The Today layout's left column: your queue first, then, for owners and admins, what needs attention. It never owns navigation:
 * every item opens through the shell's openWorkspaceTab, so resident destinations, draft checks and context stay intact.
 */
export function TodayColumn({ workspaceSlug, workspaceId, userId, canSeeAttention, cache, activeUrl, recent = [], onOpen }: {
    workspaceSlug: string; workspaceId: string; userId: string; canSeeAttention: boolean
    cache: WorkspaceRecordCache<NativePanelSnapshot>; activeUrl: string; recent?: TodayRecentDestination[]; onOpen: (href: string) => void
}) {
    const queueUrl = `/${workspaceSlug}/queue`
    const queueKey = nativePanelCacheKey(userId, workspaceId, queueUrl)
    const queueSnapshot = useSyncExternalStore(
        useCallback((notify) => cache.subscribe(queueKey, notify), [cache, queueKey]),
        useCallback(() => cache.getSnapshot(queueKey), [cache, queueKey]),
        useCallback(() => cache.getSnapshot(queueKey), [cache, queueKey]),
    )
    const [queueError, setQueueError] = useState("")
    const loadQueue = useCallback((force = false) => {
        setQueueError("")
        // Shares the Queue panel's cache entry and in-flight request; no second fetch when both are open.
        void cache.load(queueKey, (signal) => readNativePanel({ url: queueUrl, workspaceSlug, workspaceId, userId, signal }), { force })
            .catch((error: unknown) => setQueueError(error instanceof Error ? error.message : "Could not load your queue."))
    }, [cache, queueKey, queueUrl, workspaceSlug, workspaceId, userId])
    useEffect(() => { loadQueue() }, [loadQueue])

    const memoryKey = `${userId}:${workspaceSlug}`
    const [attention, setAttentionState] = useState<AttentionState>(() => attentionMemory.get(memoryKey)?.state ?? { status: "loading" })
    const lastAttention = useRef(attentionMemory.get(memoryKey)?.at ?? 0)
    const setAttention = useCallback((next: AttentionState | ((current: AttentionState) => AttentionState)) => {
        setAttentionState(current => {
            const value = typeof next === "function" ? next(current) : next
            if (value.status === "ready" || value.status === "unavailable") attentionMemory.set(memoryKey, { state: value, at: lastAttention.current })
            return value
        })
    }, [memoryKey])
    // The clock for relative wording ("26h", "Due today"). It advances with each Needs attention read, never on a timer.
    const [now, setNow] = useState(() => Date.now())
    const loadAttention = useCallback(async (signal?: AbortSignal) => {
        lastAttention.current = Date.now()
        setNow(lastAttention.current)
        try {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/needs-attention`, {
                cache: "no-store", redirect: "error", credentials: "same-origin", headers: { "x-workspace-user": userId },
                signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
            })
            const value = await response.json() as { available?: boolean; groups?: AttentionGroup[]; error?: string }
            if (signal?.aborted) return
            if (!response.ok) { setAttention({ status: "error", message: value.error ?? "Could not load what needs attention." }); return }
            setAttention(value.available === false ? { status: "unavailable" } : { status: "ready", groups: value.groups ?? [] })
        } catch (error) {
            if (signal?.aborted) return
            setAttention(current => current.status === "ready" ? current : { status: "error", message: error instanceof Error ? error.message : "Could not load what needs attention." })
        }
    }, [workspaceSlug, userId, setAttention])
    useEffect(() => {
        if (!canSeeAttention) return
        const controller = new AbortController()
        if (Date.now() - lastAttention.current >= ATTENTION_REFRESH_MS) void loadAttention(controller.signal)
        // Quiet foreground refresh only: no polling and no work while the window is hidden.
        const refresh = () => {
            if (document.visibilityState === "visible" && Date.now() - lastAttention.current >= ATTENTION_REFRESH_MS) void loadAttention(controller.signal)
        }
        document.addEventListener("visibilitychange", refresh)
        window.addEventListener("focus", refresh)
        return () => { controller.abort(); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh) }
    }, [canSeeAttention, loadAttention])

    // Team is read only when someone chooses it, never at shell start, so the scope always opens on Mine.
    const [scope, setScope] = useState<"mine" | "team">("mine")
    const [team, setTeam] = useState<TeamState>(() => teamMemory.get(memoryKey)?.state ?? { status: "idle" })
    const lastTeam = useRef(teamMemory.get(memoryKey)?.at ?? 0)
    const loadTeam = useCallback(async (signal?: AbortSignal) => {
        lastTeam.current = Date.now()
        setTeam(current => current.status === "ready" ? current : { status: "loading" })
        try {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/team-queue`, {
                cache: "no-store", redirect: "error", credentials: "same-origin", headers: { "x-workspace-user": userId },
                signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
            })
            const value = await response.json() as { available?: boolean; people?: TeamQueue["people"]; truncated?: boolean; error?: string }
            if (signal?.aborted) return
            if (!response.ok) { setTeam(current => current.status === "ready" ? current : { status: "error", message: value.error ?? "Could not load the team's queue." }); return }
            const next: TeamState = value.available === false ? { status: "unavailable" } : { status: "ready", queue: { people: value.people ?? [], truncated: value.truncated === true } }
            teamMemory.set(memoryKey, { state: next, at: lastTeam.current })
            setTeam(next)
        } catch (error) {
            if (signal?.aborted) return
            setTeam(current => current.status === "ready" ? current : { status: "error", message: error instanceof Error ? error.message : "Could not load the team's queue." })
        }
    }, [workspaceSlug, userId, memoryKey])
    const showTeam = canSeeAttention && scope === "team"
    useEffect(() => {
        if (!showTeam) return
        const controller = new AbortController()
        // Deferred a microtask so the read never starts inside the render that chose Team.
        void Promise.resolve().then(() => { if (!controller.signal.aborted && Date.now() - lastTeam.current >= ATTENTION_REFRESH_MS) void loadTeam(controller.signal) })
        return () => controller.abort()
    }, [showTeam, loadTeam])

    const activePath = pathOf(activeUrl)
    const queue = queueSnapshot.data?.kind === "queue" ? queueSnapshot.data as PersonalQueueSnapshot : null
    const queueItems = useMemo(() => queue ? rankQueue(queue.items).filter(item => item.state === "Ready" || item.state === "In progress" || item.state === "Blocked" || item.state === "Disputed").slice(0, QUEUE_ROWS) : [], [queue])
    // Identical items (the same kind, title and client) read as one line with a count, so a repeated report cannot
    // fill the column. The oldest occurrence supplies the waiting time; one occurrence opens directly, several open the list.
    const attentionRows = useMemo(() => {
        if (attention.status !== "ready") return []
        const merged = new Map<string, { group: AttentionGroup; item: AttentionGroup["items"][number]; href: string | null; count: number }>()
        for (const group of attention.groups) for (const item of group.items) {
            const key = `${group.kind}\u0000${item.title}\u0000${item.client ?? ""}`
            const existing = merged.get(key)
            if (!existing) { merged.set(key, { group, item, href: attentionHref(workspaceSlug, group.kind, item), count: 1 }); continue }
            existing.count++
            if (item.since && (!existing.item.since || item.since < existing.item.since)) existing.item = { ...existing.item, since: item.since }
        }
        return [...merged.values()].slice(0, ATTENTION_ROWS)
    }, [attention, workspaceSlug])
    const attentionShown = attentionRows.reduce((sum, row) => sum + row.count, 0)
    const attentionTotal = attention.status === "ready" ? attention.groups.reduce((sum, group) => sum + group.total, 0) : 0
    const attentionUrl = `/${workspaceSlug}/queue/attention`

    // Remembered per person and workspace on this device only; the column works the same when storage is unavailable.
    const collapsedKey = `betelgeze:today:attention-collapsed:${userId}:${workspaceSlug}`
    const [attentionCollapsed, setAttentionCollapsed] = useState(() => readCollapsed(collapsedKey))
    const toggleAttention = () => setAttentionCollapsed(current => {
        try { window.localStorage.setItem(collapsedKey, current ? "0" : "1") } catch { /* preference only */ }
        return !current
    })
    const teamRows = useMemo(() => team.status === "ready" ? teamQueueRows(team.queue, QUEUE_ROWS, now) : [], [team, now])
    const teamReady = team.status === "ready" ? team.queue.people.reduce((sum, person) => sum + person.ready, 0) : 0
    const recentRows = recent.filter(destination => pathOf(destination.url) !== activePath).slice(0, RECENT_ROWS)

    return <aside data-workspace-today-column aria-label="Today" className="flex h-full flex-col gap-5 overflow-y-auto overscroll-contain px-3 pb-6 pt-3">
        <section aria-labelledby="today-queue">
            <SectionHeading id="today-queue" title={showTeam ? "Team queue" : "Your queue"}
                count={showTeam ? (team.status === "ready" ? <span className="text-sm tabular-nums text-neutral-400">{teamReady}</span> : null)
                    : queue ? <span className="text-sm tabular-nums text-neutral-400">{queue.ready}</span> : null}
                action={<Button variant="ghost" size="sm" onClick={() => onOpen(showTeam ? `/${workspaceSlug}/staff` : queueUrl)}>{showTeam ? "Open staff" : "Open queue"}</Button>} />
            {canSeeAttention ? <SegmentedSwitch label="Queue scope" value={scope} options={QUEUE_SCOPES} onChange={setScope} className="mb-2" /> : null}
            {showTeam ? (team.status === "idle" || team.status === "loading" ? <LoadingRows label="Loading the team's queue" />
                : team.status === "unavailable" ? <Notice>Needs a database update.</Notice>
                : team.status === "error" ? <Notice tone="error">{team.message} <button type="button" className="underline underline-offset-2" onClick={() => void loadTeam()}>Retry</button></Notice>
                : teamRows.length === 0 ? <Notice><Status label="Nobody else has work ready" tone="green" /></Notice>
                : <List flush ariaLabel="Team queue">
                    {teamRows.map(item => {
                        const href = `/${workspaceSlug}/work-items/${item.id}`
                        const effort = effortLabel(item.calibrated_minutes ?? item.assessment?.effort_minutes)
                        const due = dueLabel(item.due_at, now)
                        return <ListCompactItem key={item.id} current={pathOf(href) === activePath} onOpen={() => onOpen(href)}
                            meta={<>
                                <Status label={item.state} tone={item.state === "In progress" ? "yellow" : "grey"} />
                                {effort ? <span className="ml-auto shrink-0 tabular-nums">{effort}</span> : null}
                            </>}
                            title={item.title}
                            supporting={<>
                                <span className="min-w-0 truncate">{[item.owner, item.relationship].filter(Boolean).join(" · ")}</span>
                                {due ? <span className={`ml-auto shrink-0 ${due.late ? "text-red-200" : ""}`}>{due.label}</span> : null}
                            </>} />
                    })}
                    {teamReady > teamRows.length || team.queue.truncated ? <ListCompactItem onOpen={() => onOpen(`/${workspaceSlug}/staff`)}
                        title={<span className="font-normal text-neutral-300">More on the Staff panel</span>} /> : null}
                </List>)
            : null}
            {showTeam ? null : queueError && !queue ? <Notice tone="error">{queueError} <button type="button" className="underline underline-offset-2" onClick={() => loadQueue(true)}>Retry</button></Notice>
                : !queue ? <LoadingRows label="Loading your queue" />
                : queueItems.length === 0 ? <Notice><Status label="Nothing ready for you" tone="green" /></Notice>
                : <List flush ariaLabel="Your queue">{queueItems.map(item => {
                    const href = `/${workspaceSlug}/work-items/${item.id}`
                    const effort = effortLabel(item.calibrated_minutes ?? item.assessment?.effort_minutes)
                    const due = dueLabel(item.due_at, now)
                    const supporting = [item.relationship, item.shared && item.state === "In progress" && item.started_by_name ? `Started by ${item.started_by_name}` : null].filter(Boolean).join(" · ")
                    return <ListCompactItem key={item.id} current={pathOf(href) === activePath} onOpen={() => onOpen(href)}
                        meta={<>
                            <Status label={item.state} tone={item.state === "In progress" ? "yellow" : item.state === "Ready" ? "grey" : "red"} />
                            {effort ? <span className="ml-auto shrink-0 tabular-nums">{effort}</span> : null}
                        </>}
                        title={item.title}
                        supporting={supporting || due ? <>
                            {supporting ? <span className="min-w-0 truncate">{supporting}</span> : null}
                            {due ? <span className={`ml-auto shrink-0 ${due.late ? "text-red-200" : ""}`}>{due.label}</span> : null}
                        </> : undefined} />
                })}</List>}
        </section>

        {canSeeAttention ? <section aria-labelledby="today-attention">
            <div className="mb-2 flex min-h-9 items-center gap-1 px-1">
                <button type="button" data-today-attention-toggle aria-expanded={!attentionCollapsed} aria-controls="today-attention-list" onClick={toggleAttention}
                    className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-neutral-500">
                    <h2 id="today-attention" className="text-sm font-semibold text-neutral-100">Needs attention</h2>
                    {attention.status === "ready" && attentionTotal > 0 ? <RoundPill tone="red" className="tabular-nums">{attentionTotal > 99 ? "99+" : attentionTotal}</RoundPill> : null}
                    <Chevron open={!attentionCollapsed} />
                </button>
                <Button variant="ghost" size="sm" onClick={() => onOpen(attentionUrl)}>See all</Button>
            </div>
            {attentionCollapsed ? null : <div id="today-attention-list">
                {attention.status === "loading" ? <LoadingRows label="Loading what needs attention" />
                    : attention.status === "unavailable" ? <Notice>Needs a database update.</Notice>
                    : attention.status === "error" ? <Notice tone="error">{attention.message} <button type="button" className="underline underline-offset-2" onClick={() => void loadAttention()}>Retry</button></Notice>
                    : attentionRows.length === 0 ? <Notice><Status label="Nothing needs attention" tone="green" /></Notice>
                    : <List flush ariaLabel="Needs attention">
                        {attentionRows.map(({ group, item, href, count }) => {
                            const meta = ATTENTION_LABELS[group.kind]
                            const clientFirst = group.kind === "waiting_on_reply" || group.kind === "stalled_onboarding"
                            const waiting = waitingLabel(item.since, now)
                            const target = count > 1 ? attentionUrl : href
                            return <ListCompactItem key={`${group.kind}:${item.recordId}`}
                                current={target ? pathOf(target) === activePath : false}
                                onOpen={target ? () => onOpen(target) : undefined}
                                meta={<><Status label={meta.label} tone={meta.tone} />{waiting ? <span className="ml-auto shrink-0 tabular-nums" title={`Waiting ${waiting}`}>{waiting}</span> : null}</>}
                                title={clientFirst ? item.client ?? item.title : item.title}
                                supporting={count > 1 || (!clientFirst && item.client) ? <>
                                    {!clientFirst && item.client ? <span className="min-w-0 truncate">{item.client}</span> : null}
                                    {count > 1 ? <span className="ml-auto shrink-0 tabular-nums">{count} the same</span> : null}
                                </> : undefined} />
                        })}
                        {attentionTotal > attentionShown ? <ListCompactItem onOpen={() => onOpen(attentionUrl)} current={pathOf(attentionUrl) === activePath}
                            title={<span className="font-normal text-neutral-300">{attentionTotal - attentionShown} more in Needs attention</span>} /> : null}
                    </List>}
            </div>}
        </section> : null}

        {recentRows.length ? <section aria-labelledby="today-recent">
            <SectionHeading id="today-recent" title="Still open" />
            <List flush ariaLabel="Still open">
                {recentRows.map(destination => <ListCompactItem key={destination.id} onOpen={() => onOpen(destination.url)}
                    title={<span className="font-normal text-neutral-200">{destination.title}</span>} />)}
            </List>
        </section> : null}
    </aside>
}
