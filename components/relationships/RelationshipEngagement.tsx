"use client"

import { useEffect, useState } from "react"
import { DetailField, DetailFields } from "@/components/detail"
import { formatRelativeTime } from "@/lib/ui/relative-time"

type Engagement = {
    lastClientWhatsAppAt: string | null
    recentClientWhatsAppMessages: number
    lastStaffReplyAt: string | null
    portalFirstVisitAt: string | null
    portalLastVisitAt: string | null
    portalVisitCount: number
    onboardingStatus: string | null
    onboardingLastActivityAt: string | null
    onboardingCompletedAt: string | null
}

function when(value: string | null) {
    return value ? formatRelativeTime(value) : "Not yet"
}

export function RelationshipEngagement({ workspaceSlug, relationshipId }: { workspaceSlug: string; relationshipId: string }) {
    const [metrics, setMetrics] = useState<Engagement | null>(null)
    const [error, setError] = useState(false)
    useEffect(() => {
        const controller = new AbortController()
        void fetch(`/api/workspaces/${workspaceSlug}/relationships/${relationshipId}/engagement`, {
            cache: "no-store", signal: controller.signal,
        }).then(async (response) => {
            if (!response.ok) throw new Error("Metrics unavailable")
            const result = await response.json() as { engagement: Engagement }
            if (!controller.signal.aborted) setMetrics(result.engagement)
        }).catch(() => { if (!controller.signal.aborted) setError(true) })
        return () => controller.abort()
    }, [relationshipId, workspaceSlug])

    return <section aria-label="Client engagement" className="mt-5 min-h-32">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Client engagement</h2>
        {error ? <p className="mt-3 text-xs text-neutral-500">Engagement metrics are unavailable right now.</p> : !metrics ? <p className="mt-3 text-xs text-neutral-500">Loading engagement…</p> :
            <DetailFields className="!mt-2">
                <DetailField label="Last WA reply" icon="contact">{when(metrics.lastClientWhatsAppAt)}</DetailField>
                <DetailField label="WA messages" icon="activity">{Math.min(metrics.recentClientWhatsAppMessages, 1000)}{metrics.recentClientWhatsAppMessages >= 1000 ? "+" : ""} in 30 days</DetailField>
                <DetailField label="Staff reply" icon="time" className="lg:border-l lg:pl-8">{when(metrics.lastStaffReplyAt)}</DetailField>
                <DetailField label="Portal visits" icon="progress">{metrics.portalVisitCount}</DetailField>
                <DetailField label="Last portal visit" icon="timeline" className="lg:border-l lg:pl-8">{when(metrics.portalLastVisitAt)}</DetailField>
                <DetailField label="Onboarding" icon="status">{metrics.onboardingStatus === "completed" ? `Completed ${when(metrics.onboardingCompletedAt)}` : metrics.onboardingStatus ? `In progress · ${when(metrics.onboardingLastActivityAt)}` : "Not started"}</DetailField>
            </DetailFields>}
    </section>
}
