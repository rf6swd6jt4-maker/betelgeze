"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { List, ListCompactItem } from "@/components/list/List"
import { LoadingPulse } from "@/components/panel/PanelLoading"
import { RoundPill, Status } from "@/components/ui"
import { ATTENTION_LABELS, attentionHref, type AttentionGroup } from "@/lib/needs-attention"
import { dueLabel, effortLabel, waitingLabel } from "@/lib/today-column"
import { teamQueueRows, type TeamQueue } from "@/lib/team-queue"

const REFRESH_MS = 60_000
const ATTENTION_ROWS = 4
const TEAM_ROWS = 8

type AttentionState = { status: "loading" } | { status: "ready"; groups: AttentionGroup[] } | { status: "unavailable" } | { status: "error"; message: string }
type TeamState = { status: "idle" } | { status: "loading" } | { status: "ready"; queue: TeamQueue } | { status: "unavailable" } | { status: "error"; message: string }

// Last good result per account and workspace, so returning to Today within a minute reads nothing again.
const attentionMemory = new Map<string, { state: AttentionState; at: number }>()
const teamMemory = new Map<string, { state: TeamState; at: number }>()

function readCollapsed(key: string) {
    try { return window.localStorage.getItem(key) === "1" } catch { return false }
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

/** A section heading that is also its disclosure control: one activation target, title, optional count, chevron. */
function SectionToggle({ id, controls, title, count, open, onToggle }: { id: string; controls: string; title: string; count?: ReactNode; open: boolean; onToggle: () => void }) {
    return <button type="button" aria-expanded={open} aria-controls={controls} onClick={onToggle}
        className="mb-2 flex min-h-9 w-full min-w-0 items-center gap-2 rounded-lg px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-neutral-500">
        <h2 id={id} className="text-sm font-semibold text-neutral-100">{title}</h2>
        {count}
        <span className="ml-auto"><Chevron open={open} /></span>
    </button>
}

/**
 * Beside the person's queue on the Today page, for owners and admins: what needs attention, and the team's ready work
 * on request. It never owns navigation: every item opens through the shell, so resident destinations and draft checks
 * keep their one owner. Needs attention is read once and refreshed when the window returns, at most once a minute; the
 * Team queue is read only when someone opens it. No polling.
 */
export function TodaySide({ workspaceSlug, userId, onOpen }: { workspaceSlug: string; userId: string; onOpen: (href: string) => void }) {
    const memoryKey = `${userId}:${workspaceSlug}`
    const [attention, setAttentionState] = useState<AttentionState>(() => attentionMemory.get(memoryKey)?.state ?? { status: "loading" })
    const lastAttention = useRef(attentionMemory.get(memoryKey)?.at ?? 0)
    // The clock for relative wording ("26h", "Due today"). It advances with each read, never on a timer.
    const [now, setNow] = useState(() => Date.now())
    const loadAttention = useCallback(async (signal?: AbortSignal) => {
        const started = Date.now()
        lastAttention.current = started
        setNow(started)
        try {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/needs-attention`, {
                cache: "no-store", redirect: "error", credentials: "same-origin", headers: { "x-workspace-user": userId },
                signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
            })
            const value = await response.json() as { available?: boolean; groups?: AttentionGroup[]; error?: string }
            if (signal?.aborted) return
            if (!response.ok) { setAttentionState(current => current.status === "ready" ? current : { status: "error", message: value.error ?? "Could not load what needs attention." }); return }
            const next: AttentionState = value.available === false ? { status: "unavailable" } : { status: "ready", groups: value.groups ?? [] }
            attentionMemory.set(memoryKey, { state: next, at: started })
            setAttentionState(next)
        } catch (error) {
            // A cancelled read leaves no trace, so the next mount reads again instead of waiting out the minute.
            if (signal?.aborted) { if (lastAttention.current === started) lastAttention.current = 0; return }
            setAttentionState(current => current.status === "ready" ? current : { status: "error", message: error instanceof Error ? error.message : "Could not load what needs attention." })
        }
    }, [workspaceSlug, userId, memoryKey])
    useEffect(() => {
        const controller = new AbortController()
        // Quiet foreground refresh only: no polling and no work while the window is hidden.
        const refresh = () => { if (document.visibilityState === "visible" && Date.now() - lastAttention.current >= REFRESH_MS) void loadAttention(controller.signal) }
        refresh()
        document.addEventListener("visibilitychange", refresh)
        window.addEventListener("focus", refresh)
        return () => { controller.abort(); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh) }
    }, [loadAttention])

    // Identical items (the same kind, title and client) read as one line with a count, so a repeated report cannot
    // fill the section. The oldest occurrence supplies the waiting time; one occurrence opens directly, several open the list.
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
    // Remembered per person and workspace on this device only; the section works the same when storage is unavailable.
    const collapsedKey = `betelgeze:today:attention-collapsed:${userId}:${workspaceSlug}`
    const [attentionCollapsed, setAttentionCollapsed] = useState(() => readCollapsed(collapsedKey))
    const toggleAttention = () => setAttentionCollapsed(current => {
        try { window.localStorage.setItem(collapsedKey, current ? "0" : "1") } catch { /* preference only */ }
        return !current
    })

    // The Team queue costs one personal queue read per other member, so it always starts closed and is read on request.
    const [teamOpen, setTeamOpen] = useState(false)
    const [team, setTeam] = useState<TeamState>(() => teamMemory.get(memoryKey)?.state ?? { status: "idle" })
    const lastTeam = useRef(teamMemory.get(memoryKey)?.at ?? 0)
    const loadTeam = useCallback(async (signal?: AbortSignal) => {
        const started = Date.now()
        lastTeam.current = started
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
            teamMemory.set(memoryKey, { state: next, at: started })
            setTeam(next)
        } catch (error) {
            if (signal?.aborted) { if (lastTeam.current === started) lastTeam.current = 0; return }
            setTeam(current => current.status === "ready" ? current : { status: "error", message: error instanceof Error ? error.message : "Could not load the team's queue." })
        }
    }, [workspaceSlug, userId, memoryKey])
    useEffect(() => {
        if (!teamOpen) return
        const controller = new AbortController()
        // Deferred a microtask so the read never starts inside the render that opened the section.
        void Promise.resolve().then(() => { if (!controller.signal.aborted && Date.now() - lastTeam.current >= REFRESH_MS) void loadTeam(controller.signal) })
        return () => controller.abort()
    }, [teamOpen, loadTeam])
    const teamRows = useMemo(() => team.status === "ready" ? teamQueueRows(team.queue, TEAM_ROWS, now) : [], [team, now])
    const teamReady = team.status === "ready" ? team.queue.people.reduce((sum, person) => sum + person.ready, 0) : 0

    return <aside data-today-side aria-label="Team overview" className="flex min-w-0 flex-col gap-5">
        <section aria-labelledby="today-attention">
            <SectionToggle id="today-attention" controls="today-attention-list" title="Needs attention" open={!attentionCollapsed} onToggle={toggleAttention}
                count={attention.status === "ready" && attentionTotal > 0 ? <RoundPill tone="red" className="tabular-nums">{attentionTotal > 99 ? "99+" : attentionTotal}</RoundPill> : null} />
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
                                onOpen={target ? () => onOpen(target) : undefined}
                                meta={<><Status label={meta.label} tone={meta.tone} />{waiting ? <span className="ml-auto shrink-0 tabular-nums" title={`Waiting ${waiting}`}>{waiting}</span> : null}</>}
                                title={clientFirst ? item.client ?? item.title : item.title}
                                supporting={count > 1 || (!clientFirst && item.client) ? <>
                                    {!clientFirst && item.client ? <span className="min-w-0 truncate">{item.client}</span> : null}
                                    {count > 1 ? <span className="ml-auto shrink-0 tabular-nums">{count} the same</span> : null}
                                </> : undefined} />
                        })}
                        {attentionTotal > attentionShown ? <ListCompactItem onOpen={() => onOpen(attentionUrl)}
                            title={<span className="font-normal text-neutral-300">{attentionTotal - attentionShown} more in Needs attention</span>} /> : null}
                    </List>}
            </div>}
        </section>

        <section aria-labelledby="today-team">
            <SectionToggle id="today-team" controls="today-team-list" title="Team queue" open={teamOpen} onToggle={() => setTeamOpen(open => !open)}
                count={teamOpen && team.status === "ready" ? <span className="text-sm tabular-nums text-neutral-400">{teamReady}</span> : null} />
            {teamOpen ? <div id="today-team-list">
                {team.status === "idle" || team.status === "loading" ? <LoadingRows label="Loading the team's queue" />
                    : team.status === "unavailable" ? <Notice>Needs a database update.</Notice>
                    : team.status === "error" ? <Notice tone="error">{team.message} <button type="button" className="underline underline-offset-2" onClick={() => void loadTeam()}>Retry</button></Notice>
                    : teamRows.length === 0 ? <Notice><Status label="Nobody else has work ready" tone="green" /></Notice>
                    : <List flush ariaLabel="Team queue">
                        {teamRows.map(item => {
                            const effort = effortLabel(item.calibrated_minutes ?? item.assessment?.effort_minutes)
                            const due = dueLabel(item.due_at, now)
                            return <ListCompactItem key={item.id} onOpen={() => onOpen(`/${workspaceSlug}/work-items/${item.id}`)}
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
                    </List>}
            </div> : null}
        </section>
    </aside>
}
