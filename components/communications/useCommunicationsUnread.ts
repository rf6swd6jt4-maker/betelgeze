"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { subscribeChatReads } from "@/lib/communications/read-state"
import { applyReadToSummary, createUnreadSummaryResource, type UnreadSummary } from "@/lib/communications/unread-summary"

// The shell owns one metadata summary; mounted chat copies never overwrite it
// with their independently loaded (and potentially stale) local totals.
export function useCommunicationsUnread(workspaceId: string, workspaceSlug: string, userId: string, enabled: boolean) {
    const scope = `${workspaceId}:${userId}`
    const [snapshot, setSnapshot] = useState<{ scope: string; rows: UnreadSummary[] }>({ scope, rows: [] })
    const [stale, setStale] = useState(false)
    const invalidateRef = useRef<() => void>(() => undefined)
    const invalidate = useCallback(() => invalidateRef.current(), [])

    useEffect(() => {
        if (!enabled) return
        let timer: ReturnType<typeof setTimeout> | null = null
        const controller = new AbortController()
        const resource = createUnreadSummaryResource(async () => {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/communications/unread`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
            const result = await response.json()
            if (!response.ok || !Array.isArray(result.conversations)) throw new Error("Unread counts unavailable")
            return result.conversations as UnreadSummary[]
        }, next => { setSnapshot({ scope, rows: next }); setStale(false) }, () => setStale(true))
        const schedule = () => {
            resource.invalidate()
            if (document.visibilityState !== "visible" || timer !== null) return
            // Coalesce messages/read acknowledgements from multiple resident tabs.
            timer = setTimeout(() => { timer = null; void resource.refresh() }, 250)
        }
        invalidateRef.current = schedule
        const unsubscribe = subscribeChatReads(workspaceId, userId, read => {
            setSnapshot(current => ({ scope, rows: applyReadToSummary(current.scope === scope ? current.rows : [], read) }))
            schedule()
        })
        window.addEventListener("focus", schedule)
        window.addEventListener("online", schedule)
        document.addEventListener("visibilitychange", schedule)
        schedule()
        return () => {
            invalidateRef.current = () => undefined
            if (timer !== null) clearTimeout(timer)
            controller.abort(); resource.dispose(); unsubscribe()
            window.removeEventListener("focus", schedule)
            window.removeEventListener("online", schedule)
            document.removeEventListener("visibilitychange", schedule)
        }
    }, [enabled, scope, userId, workspaceId, workspaceSlug])
    return { count: enabled && snapshot.scope === scope ? snapshot.rows.reduce((total, row) => total + row.count, 0) : 0, stale, invalidate }
}
