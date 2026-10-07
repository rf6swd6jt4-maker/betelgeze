"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { beginWorkspaceInteraction } from "@/lib/workspace-performance"
import { subscribeChatReadBatches } from "@/lib/communications/read-state"
import { publishUnreadSummary, subscribeUnreadSummaryInvalidations } from "@/lib/communications/unread-broadcast"
import { applyReadsToSummary, createConfirmedReadLedger, createUnreadSummaryResource, type UnreadSummary } from "@/lib/communications/unread-summary"

// The shell owns one metadata summary; mounted chat copies never overwrite it
// with their independently loaded (and potentially stale) local totals.
export function useCommunicationsUnread(workspaceId: string, workspaceSlug: string, userId: string, enabled: boolean) {
    const scope = `${workspaceId}:${userId}`
    const [snapshot, setSnapshot] = useState<{ scope: string; rows: UnreadSummary[]; loaded: boolean }>({ scope, rows: [], loaded: false })
    const [stale, setStale] = useState(false)
    const invalidateRef = useRef<() => void>(() => undefined)
    const invalidate = useCallback(() => invalidateRef.current(), [])

    useEffect(() => {
        if (enabled && snapshot.loaded && snapshot.scope === scope) publishUnreadSummary({ workspaceId, userId, rows: snapshot.rows, stale })
    }, [enabled, scope, snapshot, stale, userId, workspaceId])

    useEffect(() => {
        if (!enabled) return
        const controller = new AbortController()
        const confirmedReads = createConfirmedReadLedger(workspaceId, userId)
        const invalidationEvents = new Set<string>()
        const resource = createUnreadSummaryResource(async () => {
            const timing = beginWorkspaceInteraction({ workspaceSlug, operation: "command", command: "message.unread", routeSection: "communications", cacheState: "network" })
            try {
                const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/communications/unread`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
                const result = await response.json()
                if (!response.ok || !Array.isArray(result.conversations)) throw new Error("Unread counts unavailable")
                timing.mark("data_ready")
                timing.finish("completed", "data_ready")
                return result.conversations as UnreadSummary[]
            } catch (error) { timing.finish(controller.signal.aborted ? "aborted" : "failed"); throw error }
        }, next => { setSnapshot({ scope, rows: confirmedReads.apply(next), loaded: true }); setStale(false) }, () => setStale(true))
        const schedule = () => {
            resource.invalidate()
            if (document.visibilityState !== "visible") return
            // Leading event starts immediately. The resource serializes requests
            // and coalesces all in-flight invalidations into the next refresh.
            void resource.refresh()
        }
        invalidateRef.current = schedule
        const unsubscribeInvalidations = subscribeUnreadSummaryInvalidations(workspaceId, userId, eventKey => {
            if (eventKey) {
                if (invalidationEvents.has(eventKey)) return
                invalidationEvents.add(eventKey)
                if (invalidationEvents.size > 256) invalidationEvents.delete(invalidationEvents.values().next().value!)
            }
            schedule()
        })
        const unsubscribe = subscribeChatReadBatches(workspaceId, userId, (reads, options) => {
            const accepted = confirmedReads.accept(reads)
            if (!accepted.length) return
            setSnapshot(current => ({ scope, rows: applyReadsToSummary(current.scope === scope ? current.rows : [], accepted), loaded: current.scope === scope && current.loaded }))
            // A database event and its resident-frame copy are one acknowledgement.
            // Snapshot callers already perform their single recovery invalidation.
            resource.invalidate()
            if (options.reconcile && document.visibilityState === "visible") void resource.refresh()
        })
        window.addEventListener("focus", schedule)
        window.addEventListener("online", schedule)
        document.addEventListener("visibilitychange", schedule)
        schedule()
        return () => {
            invalidateRef.current = () => undefined
            controller.abort(); resource.dispose(); confirmedReads.clear(); invalidationEvents.clear(); unsubscribe(); unsubscribeInvalidations()
            window.removeEventListener("focus", schedule)
            window.removeEventListener("online", schedule)
            document.removeEventListener("visibilitychange", schedule)
        }
    }, [enabled, scope, userId, workspaceId, workspaceSlug])
    return { count: enabled && snapshot.scope === scope ? snapshot.rows.reduce((total, row) => total + row.count, 0) : 0, stale, invalidate }
}
