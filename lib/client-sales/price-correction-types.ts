export type CorrectedPriceLine = { id: string; upfrontCents: number; recurringCents: number }
export type CorrectedSaleTerms = {
    lines: CorrectedPriceLine[]
    upfrontTotal: number
    recurringTotal: number
    billingInterval: "week" | "month" | "year"
    billingIntervalCount: number
}
export type PriceCorrectionRequest = {
    requestId: string
    saleId: string
    expectedVersion: number
    terms: CorrectedSaleTerms
    reason: string
}
export type PriceCorrectionRecord = {
    request_id: string
    sale_id: string
    expected_version: number
    terms: CorrectedSaleTerms
    reason: string
    previous_checkout_id: string | null
    state: "pending" | "committed" | "rejected"
}
export type SalePricingOverride = Omit<CorrectedSaleTerms, "lines"> & { linePrices: Record<string, Omit<CorrectedPriceLine, "id">> }
export type PriceCorrectionPage = {
    saleId: string
    version: number
    currency: string
    terms: CorrectedSaleTerms
    lines: Array<{ id: string; name: string; recurringAllowed: boolean }>
    pending: PriceCorrectionRecord | null
}

export function validPriceCorrection(value: unknown): value is PriceCorrectionRequest {
    if (!value || typeof value !== "object") return false
    const x = value as PriceCorrectionRequest, uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
    const t = x.terms
    return uuid.test(x.requestId) && uuid.test(x.saleId) && Number.isSafeInteger(x.expectedVersion) && x.expectedVersion >= 0
        && typeof x.reason === "string" && x.reason.trim().length >= 10 && x.reason.trim().length <= 1000
        && Boolean(t) && ["week", "month", "year"].includes(t.billingInterval) && Number.isSafeInteger(t.billingIntervalCount)
        && t.billingIntervalCount >= 1 && t.billingIntervalCount <= ({ week: 156, month: 36, year: 3 }[t.billingInterval] ?? 0)
        && Array.isArray(t.lines) && t.lines.length > 0 && t.lines.length <= 30 && new Set(t.lines.map(l => l?.id)).size === t.lines.length
        && t.lines.every(l => l && uuid.test(l.id) && [l.upfrontCents,l.recurringCents].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 99999999) && l.upfrontCents+l.recurringCents > 0)
        && t.upfrontTotal === t.lines.reduce((sum,l) => sum+l.upfrontCents,0) && t.recurringTotal === t.lines.reduce((sum,l) => sum+l.recurringCents,0)
        && t.upfrontTotal+t.recurringTotal <= 99999999
}
