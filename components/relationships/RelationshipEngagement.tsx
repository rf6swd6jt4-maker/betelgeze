"use client"

import { useEffect, useState } from "react"
import { DetailField, DetailFields } from "@/components/detail"
import { TrendChart } from "@/components/ui"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"

type Day = { day: string; client: number; ours: number; visits: number }
type Engagement = {
    lastClientMessageAt: string | null; lastStaffReplyAt: string | null
    portalFirstVisitAt: string | null; portalLastVisitAt: string | null; portalVisitCount: number
    clientMessages30d: number; ourMessages30d: number; messageSampleLimited: boolean; trends: Day[]
    onboardingStatus: string | null; onboardingCompletedAt: string | null
}
const retained = new Map<string, { data: Engagement; at: number }>()
function when(value: string | null) { return value ? formatRelativeTime(value) : "Not yet" }
function Chart({ title, detail, days, value }: { title: string; detail: string; days: Day[]; value: (day: Day) => number | null }) {
    const maximum = Math.max(1, ...days.map(value).filter((item): item is number => item !== null))
    return <article className="min-w-0 rounded-xl border border-neutral-800 bg-black p-4"><h3 className="text-sm font-medium text-neutral-200">{title}</h3><p className="mt-1 min-h-9 text-xs text-neutral-500">{detail}</p><TrendChart ariaLabel={title} points={days.flatMap((day, position) => { const amount = value(day); return amount === null ? [] : [{ id: day.day, position, value: amount, breakBefore: position > 0 && value(days[position - 1]) === null, ariaLabel: `${day.day}: ${amount}`, tooltipLabel: new Date(`${day.day}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short" }), tooltipValue: String(amount) }] })} domainEnd={Math.max(1, days.length - 1)} min={0} max={maximum} labels={days.length ? [{ id: "start", position: 0, label: new Date(`${days[0].day}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short" }), anchor: "start" }, { id: "end", position: days.length - 1, label: "Today", anchor: "end" }] : []} emptyLabel="No activity yet" /></article>
}
export function RelationshipEngagement({ workspaceSlug, relationshipId, userId }: { workspaceSlug: string; relationshipId: string; userId: string }) {
    const navigation = useWorkspaceNavigation()
    const active = navigation?.active !== false
    const key = `${userId}:${workspaceSlug}:${relationshipId}`
    const [metrics, setMetrics] = useState<Engagement | null>(() => retained.get(key)?.data ?? null)
    const [error, setError] = useState(false)
    useEffect(() => {
        if (!active || (retained.get(key) && Date.now() - retained.get(key)!.at < 60_000)) return
        const controller = new AbortController()
        void fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/relationships/${encodeURIComponent(relationshipId)}/engagement`, { cache: "no-store", signal: controller.signal })
            .then(async response => { if (!response.ok) throw new Error("Metrics unavailable"); return response.json() as Promise<{ engagement: Engagement }> })
            .then(result => { if (!controller.signal.aborted) { retained.set(key, { data: result.engagement, at: Date.now() }); setMetrics(result.engagement); setError(false) } })
            .catch(() => { if (!controller.signal.aborted) setError(true) })
        return () => controller.abort()
    }, [active, key, workspaceSlug, relationshipId])
    const days = metrics?.trends ?? []
    return <section aria-label="Client engagement" className="mt-6 border-t border-neutral-800 pt-5">
        <h2 className="text-lg font-semibold text-white">Client engagement</h2>
        <p className="mt-1 text-xs text-neutral-500">Communication and portal activity over the last 14 days.{metrics?.messageSampleLimited ? " Message trends use the latest 5,000 messages." : ""}</p>
        {error ? <p role="alert" className="mt-3 text-xs text-red-300">Engagement could not update. {metrics ? "Showing the last loaded data." : "Try opening this page again."}</p> : null}
        {metrics ? <><div className="mt-4 grid gap-3 lg:grid-cols-3">
            <Chart title="Client messages" detail="Messages sent by the client" days={days} value={day => day.client} />
            <Chart title="Portal visits" detail="Visits to the client portal" days={days} value={day => day.visits} />
            <Chart title="Client to team ratio" detail="Client messages per team message" days={days} value={day => day.ours ? Math.round(day.client / day.ours * 100) / 100 : null} />
        </div><DetailFields className="!mt-4">
            <DetailField label="Last client message" icon="contact">{when(metrics.lastClientMessageAt)}</DetailField>
            <DetailField label="Last staff reply" icon="time">{when(metrics.lastStaffReplyAt)}</DetailField>
            <DetailField label="Last portal visit" icon="timeline">{when(metrics.portalLastVisitAt)}</DetailField>
            <DetailField label="Portal visits" icon="progress">{metrics.portalVisitCount}</DetailField>
            <DetailField label="Messages, 30 days" icon="activity">{metrics.clientMessages30d} client · {metrics.ourMessages30d} ours{metrics.messageSampleLimited ? " · latest 5,000 sampled" : ""}</DetailField>
            <DetailField label="Onboarding" icon="status">{metrics.onboardingStatus === "completed" ? `Completed ${when(metrics.onboardingCompletedAt)}` : metrics.onboardingStatus ?? "Not started"}</DetailField>
        </DetailFields></> : !error ? <p className="mt-3 text-xs text-neutral-500">Loading engagement…</p> : null}
    </section>
}
