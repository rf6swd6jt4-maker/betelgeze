export const googleAdsPeriods = { last7: "Last 7 days", last30: "Last 30 days", month: "This month" } as const
export type GoogleAdsPeriod = keyof typeof googleAdsPeriods
export type GoogleAdsReport = {
    customerId: string; currency: string; timeZone: string; startDate: string; endDate: string
    spend: number; impressions: number; clicks: number; conversions: number; costPerConversion: number | null
}
export type GoogleAdsReportSnapshot = { report: GoogleAdsReport; refreshedAt: string }
export function isGoogleAdsPeriod(value: unknown): value is GoogleAdsPeriod { return value === "last7" || value === "last30" || value === "month" }
export function googleAdsDateRange(period: GoogleAdsPeriod, timeZone: string, now = new Date()) {
    if (!isGoogleAdsPeriod(period)) throw new Error("Choose a reporting period.")
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)
    const value = (type: string) => parts.find((part) => part.type === type)!.value
    const endDate = `${value("year")}-${value("month")}-${value("day")}`
    const start = new Date(`${endDate}T12:00:00Z`)
    if (period === "month") start.setUTCDate(1)
    else start.setUTCDate(start.getUTCDate() - (period === "last7" ? 6 : 29))
    return { startDate: start.toISOString().slice(0, 10), endDate }
}
export function parseGoogleAdsMetrics(payload: unknown) {
    if (!payload || typeof payload !== "object") throw new Error("Google returned an unreadable report. Please retry.")
    const p = payload as { results?: { metrics?: Record<string, unknown> }[]; nextPageToken?: string }
    if (p.nextPageToken || p.results !== undefined && (!Array.isArray(p.results) || p.results.length > 1)) throw new Error("Google returned an unexpected report. Please retry.")
    // A successful aggregate search with no rows is a valid zero-activity period.
    const metrics = p.results?.[0]?.metrics
    if (p.results?.length && (!metrics || typeof metrics !== "object")) throw new Error("Google returned an incomplete report. Please retry.")
    const numeric = (key: string, whole = false) => {
        const raw = metrics?.[key] ?? 0
        if (typeof raw !== "number" && (typeof raw !== "string" || !/^\d+(\.\d+)?$/.test(raw))) throw new Error("Google returned invalid metric values.")
        const number = Number(raw)
        if (!Number.isFinite(number) || number < 0 || whole && !Number.isSafeInteger(number)) throw new Error("Google returned invalid metric values.")
        return number
    }
    const spend = numeric("costMicros", true) / 1_000_000, conversions = numeric("conversions")
    return { spend, impressions: numeric("impressions", true), clicks: numeric("clicks", true), conversions, costPerConversion: conversions > 0 ? spend / conversions : null }
}
