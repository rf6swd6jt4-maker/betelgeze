"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { beginWorkspaceInteraction } from "@/lib/workspace-performance"
import { mergeChatReadCursors, normalizeChatReadUpdate, type ChatReadUpdate } from "@/lib/communications/read-state"
import { subscribeDeviceChatReads } from "@/lib/communications/device-read-state"
import { publishUnreadSummary, subscribeUnreadSummaryInvalidations } from "@/lib/communications/unread-broadcast"
import { applyReadToSummary, createConfirmedReadLedger, createUnreadSummaryResource, type UnreadSummary } from "@/lib/communications/unread-summary"

type DeviceUnreadResult = { deviceId: string; rows: UnreadSummary[] } & (
    | { cursorsIncluded: true; readCursors: ChatReadUpdate[] }
    | { cursorsIncluded: false }
)
class DeviceIdentityUnavailable extends Error {}
const cursorKey = (cursor: ChatReadUpdate) => `${cursor.kind}:${cursor.conversationId}`

// One authenticated installation summary owns badges and device read positions.
// Account-wide receipt cursors never enter this state.
export function useCommunicationsUnread(workspaceId: string, workspaceSlug: string, userId: string, enabled: boolean) {
    const scope = `${workspaceId}:${userId}`
    const [snapshot, setSnapshot] = useState<{ scope: string; deviceId: string | null; rows: UnreadSummary[]; readCursors: ChatReadUpdate[]; loaded: boolean }>({ scope, deviceId: null, rows: [], readCursors: [], loaded: false })
    const [stale, setStale] = useState(false)
    const invalidateRef = useRef<() => void>(() => undefined)
    const invalidate = useCallback(() => invalidateRef.current(), [])

    useEffect(() => {
        if (enabled && snapshot.scope === scope) publishUnreadSummary({ workspaceId, userId, deviceId: snapshot.deviceId, rows: snapshot.rows, readCursors: snapshot.readCursors, loaded: snapshot.loaded, stale })
    }, [enabled, scope, snapshot, stale, userId, workspaceId])

    useEffect(() => {
        if (!enabled) return
        const controller = new AbortController()
        const confirmedReads = createConfirmedReadLedger(workspaceId, userId)
        const invalidationEvents = new Set<string>()
        let currentDeviceId: string | null = null
        // Keep this requirement until the resource accepts a full response.
        // An older in-flight count request (including a failure) cannot clear it.
        let needsCursorSnapshot = true
        let requestedDeviceObservation = false
        const resource = createUnreadSummaryResource<DeviceUnreadResult>(async () => {
            const timing = beginWorkspaceInteraction({ workspaceSlug, operation: "command", command: "message.unread", routeSection: "communications", cacheState: "network" })
            try {
                const includeCursors = needsCursorSnapshot
                const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/communications/unread?scope=device${includeCursors ? "&cursors=1" : ""}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
                const result = await response.json()
                if (response.status === 409) throw new DeviceIdentityUnavailable("This installation is being verified.")
                if (!response.ok || typeof result.deviceId !== "string" || !result.deviceId || !Array.isArray(result.conversations) || typeof result.cursorsIncluded !== "boolean") throw new Error("Unread counts unavailable")
                if (includeCursors && !result.cursorsIncluded) throw new Error("Device read positions unavailable")
                const next = { deviceId: result.deviceId, rows: result.conversations as UnreadSummary[] }
                let metadata: DeviceUnreadResult
                if (result.cursorsIncluded) {
                    if (!Array.isArray(result.readCursors)) throw new Error("Device read positions unavailable")
                    const readCursors = result.readCursors.map((value: ChatReadUpdate) => normalizeChatReadUpdate({ workspaceId, userId, kind: value?.kind }, value))
                    if (readCursors.some((value: ChatReadUpdate | null) => !value)) throw new Error("Device read positions unavailable")
                    metadata = { ...next, cursorsIncluded: true, readCursors: readCursors as ChatReadUpdate[] }
                } else metadata = { ...next, cursorsIncluded: false }
                timing.mark("data_ready")
                timing.finish("completed", "data_ready")
                return metadata
            } catch (error) { timing.finish(controller.signal.aborted ? "aborted" : "failed"); throw error }
        }, next => {
            if (!next.cursorsIncluded && next.deviceId !== currentDeviceId) {
                // A cookie can change when two new browser tabs establish an
                // installation concurrently. Never lend the old device's read
                // positions to the replacement identity.
                needsCursorSnapshot = true
                currentDeviceId = null
                confirmedReads.clear(); invalidationEvents.clear()
                setSnapshot(current => current.scope === scope
                    ? { ...current, deviceId: null }
                    : { scope, deviceId: null, rows: [], readCursors: [], loaded: false })
                setStale(true)
                if (document.visibilityState === "visible") resource.invalidate()
                return
            }
            requestedDeviceObservation = false
            if (next.deviceId !== currentDeviceId) { confirmedReads.clear(); invalidationEvents.clear(); currentDeviceId = next.deviceId }
            if (next.cursorsIncluded) {
                needsCursorSnapshot = false
                confirmedReads.accept(next.readCursors)
                const keys = new Set(next.readCursors.map(cursorKey))
                setSnapshot(current => ({ scope, deviceId: next.deviceId, rows: confirmedReads.apply(next.rows), loaded: true,
                    readCursors: current.scope === scope && current.deviceId === next.deviceId
                        ? mergeChatReadCursors(next.readCursors, current.readCursors.filter(cursor => keys.has(cursorKey(cursor))), cursorKey)
                        : next.readCursors,
                }))
            } else setSnapshot(current => current.scope === scope && current.deviceId === next.deviceId
                ? { ...current, rows: confirmedReads.apply(next.rows), loaded: true }
                : current)
            setStale(false)
        }, error => {
            if (error instanceof DeviceIdentityUnavailable) {
                needsCursorSnapshot = true
                currentDeviceId = null
                confirmedReads.clear(); invalidationEvents.clear()
                // Retain the last confirmed badge while installation binding
                // recovers. A missing deviceId disables new read observations.
                setSnapshot(current => current.scope === scope
                    ? { ...current, deviceId: null }
                    : { scope, deviceId: null, rows: [], readCursors: [], loaded: false })
                // One explicit retry per unresolved binding episode. Successful
                // presence signals refresh metadata, but repeated 409s cannot
                // create a POST/GET loop. Normal online/focus visits can retry.
                if (!requestedDeviceObservation) {
                    requestedDeviceObservation = true
                    const host = window.top ?? window
                    host.dispatchEvent(new Event("betelgeze:device-observation-required"))
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
        const unsubscribe = subscribeDeviceChatReads(workspaceId, userId, read => {
            if (read.deviceId !== currentDeviceId) {
                // A sibling can acknowledge while our first device summary is
                // in flight. Re-read after that event without importing an
                // installation position before the server verifies our scope.
                if (currentDeviceId === null) schedule()
                return
            }
            if (!confirmedReads.accept([read]).length) return
            setSnapshot(current => current.scope === scope && current.deviceId === read.deviceId
                ? { ...current, rows: applyReadToSummary(current.rows, read), readCursors: mergeChatReadCursors(current.readCursors, [read], cursorKey) }
                : current)
            resource.invalidate()
            if (document.visibilityState === "visible") void resource.refresh()
        })
        const scheduleCursorSnapshot = () => { needsCursorSnapshot = true; schedule() }
        window.addEventListener("focus", scheduleCursorSnapshot)
        window.addEventListener("online", scheduleCursorSnapshot)
        window.addEventListener("betelgeze:device-observed", scheduleCursorSnapshot)
        document.addEventListener("visibilitychange", scheduleCursorSnapshot)
        schedule()
        return () => {
            invalidateRef.current = () => undefined
            controller.abort(); resource.dispose(); confirmedReads.clear(); invalidationEvents.clear(); unsubscribe(); unsubscribeInvalidations()
            window.removeEventListener("focus", scheduleCursorSnapshot)
            window.removeEventListener("online", scheduleCursorSnapshot)
            window.removeEventListener("betelgeze:device-observed", scheduleCursorSnapshot)
            document.removeEventListener("visibilitychange", scheduleCursorSnapshot)
        }
    }, [enabled, scope, userId, workspaceId, workspaceSlug])
    const loaded = enabled && snapshot.scope === scope && snapshot.loaded
    return { count: loaded ? snapshot.rows.reduce((total, row) => total + row.count, 0) : 0, loaded, stale, invalidate }
}
