"use client"

import { useEffect, useState } from "react"
import { ActivityTrends, ActivityTrendsLoading } from "@/components/admin/ActivityTrends"
import type { AdminActivityMetricBundle, AdminActivityRange } from "@/lib/admin/activity-metrics"

type Identity = { workspaceId: string; workspaceSlug: string; userId: string }
type Snapshot = { metrics: AdminActivityMetricBundle; fetchedAt: number }
const cache = new Map<string, Snapshot>()
const inFlight = new Map<string, Promise<Snapshot>>()
const FRESH_MS = 60_000
const RETAIN_MS = 10 * 60_000

function keyFor(identity: Identity) { return `${identity.userId}:${identity.workspaceId}` }

function cached(key: string) {
    const snapshot = cache.get(key)
    if (snapshot && Date.now() - snapshot.fetchedAt < RETAIN_MS) return snapshot
    cache.delete(key)
    return null
}

async function load(identity: Identity): Promise<Snapshot> {
    const key = keyFor(identity)
    const previous = inFlight.get(key)
    if (previous) return previous
    const request = (async () => {
        const response = await fetch(`/api/workspaces/${encodeURIComponent(identity.workspaceSlug)}/panels/admin?section=activity-trends`, {
            cache: "no-store",
            signal: AbortSignal.timeout(30_000),
            headers: { "x-workspace-user": identity.userId },
        })
        if (!response.ok) throw new Error("Activity charts unavailable")
        const result = await response.json() as Identity & { metrics: AdminActivityMetricBundle }
        if (result.userId !== identity.userId || result.workspaceId !== identity.workspaceId) throw new Error("Session changed")
        const snapshot = { metrics: result.metrics, fetchedAt: Date.now() }
        cache.set(key, snapshot)
        while (cache.size > 8) cache.delete(cache.keys().next().value!)
        return snapshot
    })().finally(() => inFlight.delete(key))
    inFlight.set(key, request)
    return request
}

type Props = { identity: Identity; initialRange: AdminActivityRange; active?: boolean }

export function ActivityTrendsRemote(props: Props) {
    return <ScopedActivityTrendsRemote key={keyFor(props.identity)} {...props} />
}

function ScopedActivityTrendsRemote({ identity, initialRange, active = true }: Props) {
    const key = keyFor(identity)
    const { workspaceId, workspaceSlug, userId } = identity
    const [snapshot, setSnapshot] = useState<Snapshot | null>(() => cached(key))
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState(false)
    const [refreshIntent, setRefreshIntent] = useState(0)

    useEffect(() => {
        if (!active) return
        const existing = cached(key)
        if (existing && refreshIntent === 0 && Date.now() - existing.fetchedAt < FRESH_MS) return
        let live = true
        void Promise.resolve().then(() => {
            if (!live) return null
            setRefreshing(Boolean(existing))
            return load({ workspaceId, workspaceSlug, userId })
        }).then((next) => {
            if (!next) return
            if (!live) return
            setSnapshot(next)
            setError(false)
        }).catch(() => { if (live) setError(true) }).finally(() => { if (live) setRefreshing(false) })
        return () => { live = false }
    }, [active, workspaceId, workspaceSlug, userId, key, refreshIntent])

    const notice = error ? <p role="alert" className="mt-4 text-sm text-red-400">Activity charts could not {snapshot ? "update. Showing the last loaded data." : "load."} <button type="button" className="underline" onClick={() => { setError(false); setRefreshIntent((value) => value + 1) }}>Retry</button></p> : null
    return <>{notice}{snapshot
        ? <><ActivityTrends metrics={snapshot.metrics} initialRange={initialRange} stateKey={key} refreshing={refreshing} onRefresh={() => setRefreshIntent((value) => value + 1)} /><p className="-mt-7 mb-5 text-[11px] text-neutral-600">Updated {new Date(snapshot.fetchedAt).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}</p></>
        : error ? null : <ActivityTrendsLoading />}</>
}
