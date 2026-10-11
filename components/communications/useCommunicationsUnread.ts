"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { beginWorkspaceInteraction } from "@/lib/workspace-performance"
import { subscribeChatReadBatches } from "@/lib/communications/read-state"
import { subscribeDeviceChatReads } from "@/lib/communications/device-read-state"
import { publishUnreadSummary, subscribeUnreadSummaryInvalidations } from "@/lib/communications/unread-broadcast"
import { applyReadsToSummary, createConfirmedReadLedger, createUnreadSummaryResource, type UnreadSummary } from "@/lib/communications/unread-summary"
import type { CommunicationReadProtocol } from "@/lib/communications/read-protocol"

type SummaryResult = { rows: UnreadSummary[]; deviceId: string | null }

// A shell pins its protocol before mounting this one metadata owner. Device
// acknowledgements are isolated from the unchanged account receipt namespace.
export function useCommunicationsUnread(workspaceId: string, workspaceSlug: string, userId: string, enabled: boolean, readProtocol: CommunicationReadProtocol = "account-v1") {
    const scope = `${workspaceId}:${userId}:${readProtocol}`
    const [snapshot, setSnapshot] = useState<{ scope: string; deviceId: string | null; rows: UnreadSummary[]; loaded: boolean }>({ scope, deviceId: null, rows: [], loaded: false })
    const [stale, setStale] = useState(false)
    const invalidateRef = useRef<() => void>(() => undefined)
    const invalidate = useCallback(() => invalidateRef.current(), [])

    useEffect(() => {
        if (enabled && snapshot.scope === scope && (snapshot.loaded || readProtocol === "device-v1")) publishUnreadSummary({ workspaceId, userId, readProtocol, deviceId: snapshot.deviceId, rows: snapshot.rows, loaded: snapshot.loaded, stale })
    }, [enabled, readProtocol, scope, snapshot, stale, userId, workspaceId])

    useEffect(() => {
        if (!enabled) return
        const controller = new AbortController()
        const confirmedReads = createConfirmedReadLedger(workspaceId, userId)
        const invalidationEvents = new Set<string>()
        let currentDeviceId: string | null = null
        let requestedDeviceObservation = false
        const resource = createUnreadSummaryResource<SummaryResult>(async () => {
            const timing = beginWorkspaceInteraction({ workspaceSlug, operation: "command", command: "message.unread", routeSection: "communications", cacheState: "network" })
            try {
                const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
                const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/communications/unread?readProtocol=${readProtocol}`, { cache: "no-store", signal })
                const result = await response.json()
                signal.throwIfAborted()
                if (readProtocol === "device-v1" && response.status === 409) throw new Error("This installation is being verified.", { cause: "device_identity_unavailable" })
                if (!response.ok || !Array.isArray(result.conversations)
                    || (readProtocol === "device-v1" && (result.readProtocol !== readProtocol || typeof result.deviceId !== "string" || !result.deviceId))) throw new Error("Unread counts unavailable")
                timing.mark("data_ready")
                timing.finish("completed", "data_ready")
                return { rows: result.conversations as UnreadSummary[], deviceId: readProtocol === "device-v1" ? result.deviceId as string : null }
            } catch (error) { timing.finish(controller.signal.aborted ? "aborted" : "failed"); throw error }
        }, next => {
            if (next.deviceId !== currentDeviceId) { confirmedReads.clear(); invalidationEvents.clear(); currentDeviceId = next.deviceId }
            requestedDeviceObservation = false
            setSnapshot({ scope, deviceId: currentDeviceId, rows: confirmedReads.apply(next.rows), loaded: true })
            setStale(false)
        }, error => {
            if (error instanceof Error && error.cause === "device_identity_unavailable") {
                currentDeviceId = null
                confirmedReads.clear(); invalidationEvents.clear()
                // Preserve the last count while binding recovers, but no old
                // installation may record a new observation during recovery.
                setSnapshot(current => current.scope === scope ? { ...current, deviceId: null } : { scope, deviceId: null, rows: [], loaded: false })
                if (!requestedDeviceObservation) {
                    requestedDeviceObservation = true
                    ;(window.top ?? window).dispatchEvent(new Event("betelgeze:device-observation-required"))
                }
            }
            setStale(true)
        })
        const schedule = () => {
            resource.invalidate()
            if (document.visibilityState !== "visible") return
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
        const unsubscribe = readProtocol === "device-v1"
            ? subscribeDeviceChatReads(workspaceId, userId, read => {
                if (read.deviceId !== currentDeviceId) { if (currentDeviceId === null) schedule(); return }
                const accepted = confirmedReads.accept([read])
                if (!accepted.length) return
                setSnapshot(current => current.scope === scope && current.deviceId === read.deviceId ? { ...current, rows: applyReadsToSummary(current.rows, accepted) } : current)
                // Even a private ACK must reconcile counts beyond loaded history.
                schedule()
            })
            : subscribeChatReadBatches(workspaceId, userId, (reads, options) => {
                const accepted = confirmedReads.accept(reads)
                if (!accepted.length) return
                setSnapshot(current => ({ scope, deviceId: null, rows: applyReadsToSummary(current.scope === scope ? current.rows : [], accepted), loaded: current.scope === scope && current.loaded }))
                resource.invalidate()
                if (options.reconcile && document.visibilityState === "visible") void resource.refresh()
            })
        const observed = () => { if (readProtocol === "device-v1" && requestedDeviceObservation) schedule() }
        window.addEventListener("focus", schedule)
        window.addEventListener("online", schedule)
        window.addEventListener("betelgeze:device-observed", observed)
        document.addEventListener("visibilitychange", schedule)
        schedule()
        return () => {
            invalidateRef.current = () => undefined
            controller.abort(); resource.dispose(); confirmedReads.clear(); invalidationEvents.clear(); unsubscribe(); unsubscribeInvalidations()
            window.removeEventListener("focus", schedule)
            window.removeEventListener("online", schedule)
            window.removeEventListener("betelgeze:device-observed", observed)
            document.removeEventListener("visibilitychange", schedule)
        }
    }, [enabled, readProtocol, scope, userId, workspaceId, workspaceSlug])
    const loaded = enabled && snapshot.scope === scope && snapshot.loaded
    return { count: loaded ? snapshot.rows.reduce((total, row) => total + row.count, 0) : 0, loaded, stale, invalidate }
}
