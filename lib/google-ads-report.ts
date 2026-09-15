export const googleAdsPeriods = { last7: "Last 7 days", last30: "Last 30 days", month: "This month" } as const
export type GoogleAdsPeriod = keyof typeof googleAdsPeriods
export const googleAdsReportKinds = ["search", "local_services"] as const
export type GoogleAdsReportKind = (typeof googleAdsReportKinds)[number]
type GoogleAdsReportBase = {
    customerId: string; currency: string; timeZone: string; startDate: string; endDate: string
}
export type GoogleAdsSearchReport = GoogleAdsReportBase & {
    kind: "search"
    spend: number; impressions: number; clicks: number; conversions: number; costPerConversion: number | null
}
export type GoogleAdsLocalServicesReport = GoogleAdsReportBase & {
    kind: "local_services"
    spend: number; leads: number; chargedLeads: number; bookedLeads: number; creditedLeads: number
    phoneLeads: number; messageLeads: number; bookingLeads: number; costPerLead: number | null
}
export type GoogleAdsReport = GoogleAdsSearchReport | GoogleAdsLocalServicesReport
export type GoogleAdsReportSnapshot = { report: GoogleAdsReport; refreshedAt: string }
export function isGoogleAdsPeriod(value: unknown): value is GoogleAdsPeriod { return value === "last7" || value === "last30" || value === "month" }
export function isGoogleAdsReportKind(value: unknown): value is GoogleAdsReportKind { return value === "search" || value === "local_services" }
export function googleAdsReportKindsForServices(services: Array<{ serviceKey: string; templateId?: string | null }>): GoogleAdsReportKind[] {
    const kinds = new Set<GoogleAdsReportKind>()
    for (const service of services) {
        if (service.templateId === "google-local-services-ads" || service.serviceKey === "google-local-services-ads") kinds.add("local_services")
        if (["google-search-ads", "google-ads"].includes(service.templateId ?? "") || ["google-search-ads", "google-ads"].includes(service.serviceKey)) kinds.add("search")
    }
    return kinds.size ? [...kinds] : ["search"]
}
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

export function parseGoogleAdsCampaignMetrics(payload: unknown) {
    if (!payload || typeof payload !== "object") throw new Error("Google returned an unreadable report. Please retry.")
    const value = payload as { results?: Array<{ metrics?: Record<string, unknown> }>; nextPageToken?: string }
    const results = value.results ?? []
    if (value.nextPageToken || !Array.isArray(results) || results.length > 1_000) throw new Error("This Google Ads report is too large to show safely. Choose a shorter period.")
    const total = { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
    for (const row of results) {
        const parsed = parseGoogleAdsMetrics({ results: [row] })
        total.spend += parsed.spend; total.impressions += parsed.impressions; total.clicks += parsed.clicks; total.conversions += parsed.conversions
    }
    return { ...total, costPerConversion: total.conversions > 0 ? total.spend / total.conversions : null }
}

export function parseGoogleLocalServicesLeads(payload: unknown, spend: number) {
    if (!payload || typeof payload !== "object" || !Number.isFinite(spend) || spend < 0) throw new Error("Google returned an unreadable Local Services report. Please retry.")
    const value = payload as { results?: Array<{ localServicesLead?: Record<string, unknown> }>; nextPageToken?: string }
    const results = value.results ?? []
    if (value.nextPageToken || !Array.isArray(results) || results.length > 1_000) throw new Error("This Local Services report is too large to show safely. Choose a shorter period.")
    const counts = { leads: 0, chargedLeads: 0, bookedLeads: 0, creditedLeads: 0, phoneLeads: 0, messageLeads: 0, bookingLeads: 0 }
    for (const row of results) {
        const lead = row?.localServicesLead
        if (!lead || typeof lead !== "object") throw new Error("Google returned incomplete Local Services lead data. Please retry.")
        counts.leads++
        if (lead.leadCharged === true) counts.chargedLeads++
        if (lead.leadStatus === "BOOKED") counts.bookedLeads++
        if ((lead.creditDetails as { creditState?: unknown } | undefined)?.creditState === "CREDITED") counts.creditedLeads++
        if (lead.leadType === "PHONE_CALL") counts.phoneLeads++
        else if (lead.leadType === "MESSAGE") counts.messageLeads++
        else if (lead.leadType === "BOOKING") counts.bookingLeads++
    }
    return { ...counts, costPerLead: counts.leads ? spend / counts.leads : null }
}
