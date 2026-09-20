"use client"

import { useEffect, useRef, useState } from "react"
import type { ServiceValueSummary } from "@/lib/service-stages"

export function monthlyRelationshipValues(values: ServiceValueSummary[], kind: ServiceValueSummary["kind"]) {
    const totals = new Map<string, number>()
    for (const value of values.filter(value => value.kind === kind)) {
        const count = Math.max(1, value.billing_interval_count ?? 1)
        const factor = value.billing_interval === "year" ? 1 / 12 : value.billing_interval === "week" ? 52 / 12 : 1
        totals.set(value.currency, (totals.get(value.currency) ?? 0) + value.recurring_cents * factor / count)
    }
    return [...totals].map(([currency, cents]) => new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100) + " " + currency).join(" · ") || "0"
}

export function allTimeRelationshipValue(values: Array<{ currency: string; amount_cents: number }>) {
    return values.map(({ currency, amount_cents }) => new Intl.NumberFormat("en", { style: "currency", currency }).format(amount_cents / 100) + " " + currency).join(" · ") || "0"
}

function AllTimeValue({ workspaceSlug, relationshipId, userId, refreshKey }: { workspaceSlug: string; relationshipId: string; userId: string; refreshKey: ServiceValueSummary[] }) {
    const element = useRef<HTMLSpanElement>(null)
    const [value, setValue] = useState<string | null>(null)
    const [error, setError] = useState(false)
    useEffect(() => {
        const controller = new AbortController()
        const target = element.current
        if (!target) return
        const load = async () => {
            setError(false)
            setValue(null)
            try {
                const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/relationships/${encodeURIComponent(relationshipId)}/services?kind=all_time`, {
                    cache: "no-store", headers: { "x-workspace-user": userId },
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
                })
                if (!response.ok) throw new Error("All-time value could not load")
                const data = await response.json() as { values: Array<{ currency: string; amount_cents: number }> }
                if (!controller.signal.aborted) setValue(allTimeRelationshipValue(data.values))
            } catch { if (!controller.signal.aborted) setError(true) }
        }
        if (typeof IntersectionObserver === "undefined") void load()
        else {
            const observer = new IntersectionObserver(entries => {
                if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load() }
            }, { rootMargin: "100px" })
            observer.observe(target)
            return () => { controller.abort(); observer.disconnect() }
        }
        return () => controller.abort()
    }, [workspaceSlug, relationshipId, userId, refreshKey])
    return <span ref={element}><abbr tabIndex={0} title="All-time relationship value: gross recorded paid sales and manually entered revenue from completed historical services, grouped by currency. Payments not recorded in Betelgeze are excluded." aria-label="All-time relationship value" className="cursor-help no-underline">ARV</abbr>: {error ? "Unavailable" : value ?? "Loading…"}</span>
}

export function RelationshipValues({ values, showAllTime = false, workspaceSlug, relationshipId, userId }: { values?: ServiceValueSummary[]; showAllTime?: boolean; workspaceSlug: string; relationshipId: string; userId: string }) {
    if (!values) return null
    return <>
        <span><abbr tabIndex={0} title="Current relationship value: monthly recurring value of active sold services" aria-label="Current relationship value" className="cursor-help no-underline">CRV</abbr>: {monthlyRelationshipValues(values, "sold")}<span className="font-normal text-neutral-500"> / month</span></span>
        <span><abbr tabIndex={0} title="Potential relationship value: estimated monthly recurring value of negotiating services" aria-label="Potential relationship value" className="cursor-help no-underline">PRV</abbr>: {monthlyRelationshipValues(values, "catalogue_estimate")}<span className="font-normal text-neutral-500"> / month</span></span>
        {showAllTime ? <AllTimeValue workspaceSlug={workspaceSlug} relationshipId={relationshipId} userId={userId} refreshKey={values} /> : null}
    </>
}
