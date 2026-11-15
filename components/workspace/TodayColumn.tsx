"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow } from "@/components/list/List"
import { Status } from "@/components/ui"
import { nativePanelCacheKey, readNativePanel, type NativePanelSnapshot } from "@/components/workspace/NativeWorkspaceTab"
import { ATTENTION_LABELS, attentionHref, type AttentionGroup } from "@/lib/needs-attention"
import type { PersonalQueueSnapshot } from "@/lib/work-queue/server"
import { rankQueue } from "@/lib/work-queue/ranking"
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
const ATTENTION_ROWS = 8

type AttentionState = { status: "loading" } | { status: "ready"; groups: AttentionGroup[] } | { status: "unavailable" } | { status: "error"; message: string }

// Last good result per account and workspace, so reopening the phone sheet or remounting within a minute reuses it.
const attentionMemory = new Map<string, { state: AttentionState; at: number }>()

function pathOf(url: string) {
    try { return new URL(url, "http://workspace.invalid").pathname.replace(/\/$/, "") } catch { return url }
}

function rowButtonClass(active: boolean) {
    return `min-h-11 min-w-0 flex-1 truncate text-left text-base font-medium ${active ? "text-white underline decoration-neutral-500 underline-offset-4" : "text-neutral-100 hover:text-white"}`
}

/**
 * The Today layout's left column: your queue and, for owners and admins, what needs attention. It never owns navigation:
 * every item opens through the shell's openWorkspaceTab, so resident destinations, draft checks and context stay intact.
 */
export function TodayColumn({ workspaceSlug, workspaceId, userId, canSeeAttention, cache, activeUrl, onOpen }: {
    workspaceSlug: string; workspaceId: string; userId: string; canSeeAttention: boolean
    cache: WorkspaceRecordCache<NativePanelSnapshot>; activeUrl: string; onOpen: (href: string) => void
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
    const loadAttention = useCallback(async (signal?: AbortSignal) => {
        lastAttention.current = Date.now()
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

    const activePath = pathOf(activeUrl)
    const queue = queueSnapshot.data?.kind === "queue" ? queueSnapshot.data as PersonalQueueSnapshot : null
    const queueItems = useMemo(() => queue ? rankQueue(queue.items).filter(item => item.state === "Ready" || item.state === "In progress" || item.state === "Blocked" || item.state === "Disputed").slice(0, QUEUE_ROWS) : [], [queue])
    const attentionRows = attention.status === "ready"
        ? attention.groups.flatMap(group => group.items.map(item => ({ group, item, href: attentionHref(workspaceSlug, group.kind, item) }))).slice(0, ATTENTION_ROWS)
        : []
    const attentionTotal = attention.status === "ready" ? attention.groups.reduce((sum, group) => sum + group.total, 0) : 0

    return <aside data-workspace-today-column aria-label="Today" className="flex h-full flex-col gap-4 overflow-y-auto overscroll-contain p-3">
        {canSeeAttention ? <section aria-labelledby="today-attention">
            <div className="mb-2 flex items-center gap-2 px-1">
                <h2 id="today-attention" className="text-sm font-semibold text-neutral-200">Needs attention</h2>
                {attention.status === "ready" ? <span className="text-sm text-neutral-500">{attentionTotal}</span> : null}
                <button type="button" onClick={() => onOpen(`/${workspaceSlug}/queue/attention`)} className="ml-auto min-h-11 text-sm text-neutral-400 underline">See all</button>
            </div>
            {attention.status === "loading" ? <p role="status" className="px-1 text-sm text-neutral-500">Loading…</p>
                : attention.status === "unavailable" ? <p className="px-1 text-sm text-neutral-500">Needs a database update.</p>
                : attention.status === "error" ? <p role="alert" className="px-1 text-sm text-red-300">{attention.message} <button type="button" className="min-h-11 underline" onClick={() => void loadAttention()}>Retry</button></p>
                : attentionRows.length === 0 ? <p className="px-1 text-sm text-neutral-500">Nothing needs attention.</p>
                : <List ariaLabel="Needs attention">{attentionRows.map(({ group, item, href }) => {
                    const meta = ATTENTION_LABELS[group.kind]
                    const clientFirst = group.kind === "waiting_on_reply" || group.kind === "stalled_onboarding"
                    return <ListItem key={`${group.kind}:${item.recordId}`}>
                        <ListPrimaryRow>
                            {href ? <button type="button" onClick={() => onOpen(href)} aria-current={pathOf(href) === activePath ? "page" : undefined} className={rowButtonClass(pathOf(href) === activePath)}>{clientFirst ? item.client ?? item.title : item.title}</button>
                                : <span className="min-w-0 flex-1 truncate text-base font-medium text-neutral-100">{item.title}</span>}
                        </ListPrimaryRow>
                        <ListSecondaryRow><Status label={meta.label} tone={meta.tone} /><span className="min-w-0 truncate text-neutral-500">{clientFirst ? "" : item.client ?? ""}</span></ListSecondaryRow>
                    </ListItem>
                })}</List>}
        </section> : null}

        <section aria-labelledby="today-queue">
            <div className="mb-2 flex items-center gap-2 px-1">
                <h2 id="today-queue" className="text-sm font-semibold text-neutral-200">Your queue</h2>
                {queue ? <span className="text-sm text-neutral-500">{queue.ready}</span> : null}
                <button type="button" onClick={() => onOpen(queueUrl)} className="ml-auto min-h-11 text-sm text-neutral-400 underline">Open queue</button>
            </div>
            {queueError && !queue ? <p role="alert" className="px-1 text-sm text-red-300">{queueError} <button type="button" className="min-h-11 underline" onClick={() => loadQueue(true)}>Retry</button></p>
                : !queue ? <p role="status" className="px-1 text-sm text-neutral-500">Loading…</p>
                : queueItems.length === 0 ? <p className="px-1 text-sm text-neutral-500">Nothing ready for you.</p>
                : <List ariaLabel="Your queue">{queueItems.map(item => {
                    const href = `/${workspaceSlug}/work-items/${item.id}`
                    const active = pathOf(href) === activePath
                    return <ListItem key={item.id}>
                        <ListPrimaryRow><button type="button" onClick={() => onOpen(href)} aria-current={active ? "page" : undefined} className={rowButtonClass(active)}>{item.title}</button></ListPrimaryRow>
                        <ListSecondaryRow>
                            <Status label={item.state} tone={item.state === "In progress" ? "yellow" : item.state === "Ready" ? "grey" : "red"} />
                            <span className="min-w-0 truncate text-neutral-500">{item.relationship ?? ""}</span>
                        </ListSecondaryRow>
                    </ListItem>
                })}</List>}
        </section>
    </aside>
}
