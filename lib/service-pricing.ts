export type BillingInterval = "week" | "month" | "year"
export type ServicePricing = {
    upfrontCents: number
    recurringCents: number
    currency: string
    billingInterval?: string | null
    billingIntervalCount?: number | null
}

export function validBillingSchedule(interval: unknown, count: unknown): interval is BillingInterval {
    return typeof interval === "string" && ["week", "month", "year"].includes(interval)
        && Number.isSafeInteger(count) && Number(count) >= 1
        && Number(count) <= ({ week: 156, month: 36, year: 3 }[interval] ?? 0)
}

export function billingCadence(interval?: string | null, count?: number | null) {
    if (!validBillingSchedule(interval, count)) return "per billing period"
    return count === 1 ? `every ${interval}` : `every ${count} ${interval}s`
}

export function serviceMoney(cents: number, currency: string) {
    try { return new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100) }
    catch { return `${currency} ${(cents / 100).toFixed(2)}` }
}

export function servicePricingText(pricing: ServicePricing) {
    const first = serviceMoney(pricing.upfrontCents + pricing.recurringCents, pricing.currency)
    return `${first} at checkout${pricing.recurringCents > 0 ? `; then ${serviceMoney(pricing.recurringCents, pricing.currency)} ${billingCadence(pricing.billingInterval, pricing.billingIntervalCount)}` : "; no recurring payments"}`
}
