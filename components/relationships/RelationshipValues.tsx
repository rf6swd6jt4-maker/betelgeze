import type { ServiceValueSummary } from "@/lib/service-stages"

export function monthlyRelationshipValues(values: ServiceValueSummary[], kind: ServiceValueSummary["kind"]) {
    const totals = new Map<string, number>(values.map(value => [value.currency, 0]))
    for (const value of values.filter(value => value.kind === kind)) {
        const count = Math.max(1, value.billing_interval_count ?? 1)
        const factor = value.billing_interval === "year" ? 1 / 12 : value.billing_interval === "week" ? 52 / 12 : 1
        totals.set(value.currency, (totals.get(value.currency) ?? 0) + value.recurring_cents * factor / count)
    }
    return [...totals].map(([currency, cents]) => new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100) + " " + currency).join(" · ") || "0"
}
export function RelationshipValues({ values }: { values?: ServiceValueSummary[] }) {
    if (!values) return null
    return <><span>Current Relationship Value: {monthlyRelationshipValues(values, "sold")}<span className="font-normal text-neutral-500"> / month</span></span><span>Potential Relationship Value: {monthlyRelationshipValues(values, "catalogue_estimate")}<span className="font-normal text-neutral-500"> / month</span></span></>
}
