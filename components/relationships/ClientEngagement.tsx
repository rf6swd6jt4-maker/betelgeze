"use client"

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { DetailField, DetailFields } from "@/components/detail"
import { Status } from "@/components/ui"
import { createSectionRead } from "@/lib/client-section-read"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { useClientSection } from "./useClientSection"

// The client page's view of the engagement read (GET .../relationships/<id>/engagement): the same read the record
// page's "Client engagement" block makes, shown here as three plain numbers with a trend line each, and as rows in
// the Details column. All three pieces share one request.

type Day = { day: string; client: number; ours: number; visits: number }
type Engagement = {
    lastClientMessageAt: string | null; lastStaffReplyAt: string | null
    portalFirstVisitAt: string | null; portalLastVisitAt: string | null; portalVisitCount: number
    clientMessages30d: number; ourMessages30d: number; messageSampleLimited: boolean; trends: Day[]
    onboardingStatus: string | null; onboardingCompletedAt: string | null
}
type Target = { workspaceSlug: string; relationshipId: string; userId: string }

const engagementRead = createSectionRead<{ engagement: Engagement }>(() => "Engagement could not load.")

/** True once the element has been on screen; a section in a hidden tab stays unseen, so it reads nothing. */
function useSeen(ref: RefObject<Element | null>) {
    const [seen, setSeen] = useState(false)
    useEffect(() => {
        const node = ref.current
        if (!node || seen) return
        const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setSeen(true); observer.disconnect() } }, { rootMargin: "240px" })
        observer.observe(node)
        return () => observer.disconnect()
    }, [ref, seen])
    return seen
}

function useEngagement({ workspaceSlug, relationshipId, userId }: Target, ref: RefObject<Element | null>) {
    const seen = useSeen(ref)
    const active = useWorkspaceNavigation()?.active !== false
    const state = useClientSection(engagementRead, `${userId}:${workspaceSlug}:${relationshipId}`,
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/relationships/${encodeURIComponent(relationshipId)}/engagement`, userId, seen && active)
    return { ...state, metrics: state.data?.engagement ?? null }
}

function when(value: string | null) { return value ? formatRelativeTime(value) : "Not yet" }

function Trend({ label, total, values }: { label: string; total: ReactNode; values: Array<number | null> }) {
    const numbers = values.map(value => value ?? 0)
    const max = Math.max(1, ...numbers)
    const step = numbers.length > 1 ? 100 / (numbers.length - 1) : 100
    const points = numbers.map((value, index) => `${(index * step).toFixed(1)},${(34 - value / max * 32).toFixed(1)}`).join(" ")
    return <div className="min-w-0">
        <p className="truncate text-[13px] text-neutral-400">{label}</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums text-neutral-100">{total}</p>
        <svg aria-hidden="true" viewBox="0 0 100 36" preserveAspectRatio="none" className="mt-1.5 block h-9 w-full overflow-visible">
            <line x1="0" y1="35" x2="100" y2="35" stroke="var(--color-card-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {numbers.length > 1 ? <polyline points={points} fill="none" stroke="#a3a3a3" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null}
        </svg>
    </div>
}

/** Overview, main column: how much the client has been in touch over the last 14 days. No boxes, no captions. */
export function ClientEngagementTrends(target: Target) {
    const ref = useRef<HTMLElement>(null)
    const { metrics, error } = useEngagement(target, ref)
    const days = metrics?.trends ?? []
    const client = days.reduce((sum, day) => sum + day.client, 0), ours = days.reduce((sum, day) => sum + day.ours, 0), visits = days.reduce((sum, day) => sum + day.visits, 0)
    return <section ref={ref} aria-label="Client engagement" data-client-engagement>
        {metrics ? <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
            <Trend label="Client messages" total={client} values={days.map(day => day.client)} />
            <Trend label="Portal visits" total={visits} values={days.map(day => day.visits)} />
            <Trend label="Client messages per reply" total={ours ? (Math.round(client / ours * 10) / 10).toString() : "–"} values={days.map(day => day.ours ? day.client / day.ours : null)} />
        </div> : !error ? <p className="py-2 text-sm text-neutral-500">Loading engagement…</p> : null}
        {error ? <p role="alert" className="py-2 text-xs text-red-300">{error}{metrics ? " Showing the last loaded data." : ""}</p> : null}
        {metrics?.messageSampleLimited ? <p className="pt-2 text-xs text-neutral-500">Message trends use the latest 5,000 messages.</p> : null}
    </section>
}

/** Details column: when the two sides last spoke, and the portal. */
export function ClientActivity(target: Target) {
    const ref = useRef<HTMLDivElement>(null)
    const { metrics, error } = useEngagement(target, ref)
    return <div ref={ref} data-client-activity>
        {metrics ? <DetailFields columns={1} className="mt-0! [&>div]:grid-cols-[5.5rem_minmax(0,1fr)] sm:[&>div]:grid-cols-[5.5rem_minmax(0,1fr)]">
            <DetailField label="Last message" icon="contact">{when(metrics.lastClientMessageAt)}</DetailField>
            <DetailField label="Last reply" icon="time">{when(metrics.lastStaffReplyAt)}</DetailField>
            <DetailField label="Portal visit" icon="timeline">{metrics.portalLastVisitAt ? `${when(metrics.portalLastVisitAt)} · ${metrics.portalVisitCount} in all` : "Not yet"}</DetailField>
            <DetailField label="30 days" icon="activity">{metrics.clientMessages30d} client · {metrics.ourMessages30d} ours</DetailField>
        </DetailFields> : <p className="py-1.5 text-sm text-neutral-500">{error ?? "Loading…"}</p>}
    </div>
}

/** Details column: where onboarding stands, from the same read, leading to the Onboarding tab. */
export function ClientOnboardingStatus({ onOpen, ...target }: Target & { onOpen?: () => void }) {
    const ref = useRef<HTMLDivElement>(null)
    const { metrics } = useEngagement(target, ref)
    const status = metrics?.onboardingStatus ?? null
    const label = !metrics ? "…" : status === "completed" ? `Completed ${when(metrics.onboardingCompletedAt)}` : status ? status.charAt(0).toUpperCase() + status.slice(1) : "Not started"
    const mark = <Status label={label} tone={status === "completed" ? "green" : status ? "yellow" : "grey"} />
    return <div ref={ref} data-client-onboarding-status className="grid min-h-9 grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-2 py-1.5 text-sm">
        <p className="text-neutral-500">Onboarding</p>
        {onOpen && metrics ? <button type="button" data-icon-button onClick={onOpen} className="w-fit rounded outline-none hover:underline hover:decoration-neutral-600 hover:underline-offset-4 focus-visible:underline">{mark}</button> : mark}
    </div>
}
