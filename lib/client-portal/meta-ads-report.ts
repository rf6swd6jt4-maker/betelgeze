export type PortalMetaAdsDaily = {
    date: string
    spend: number
    impressions: number
    clicks: number
    leads: number
}

export type PortalMetaAdsReport = {
    accountName: string | null
    currency: string | null
    fetchedAt: string
    period: "last_30d"
    totals: {
        spend: number
        impressions: number
        clicks: number
        leads: number
        ctr: number | null
        cpc: number | null
        costPerLead: number | null
    }
    daily: PortalMetaAdsDaily[]
}

function finiteNonNegative(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

export function portalMetaAdsReport(value: unknown): PortalMetaAdsReport | null {
    if (!value || typeof value !== "object") return null
    const report = value as Record<string, unknown>
    const totals = report.totals && typeof report.totals === "object" ? report.totals as Record<string, unknown> : null
    if (report.period !== "last_30d" || typeof report.fetchedAt !== "string" || !totals || !Array.isArray(report.daily) || report.daily.length > 31) return null
    const spend = finiteNonNegative(totals.spend)
    const impressions = finiteNonNegative(totals.impressions)
    const clicks = finiteNonNegative(totals.clicks)
    const leads = finiteNonNegative(totals.leads)
    if (spend === null || impressions === null || clicks === null || leads === null) return null
    const ratio = (key: string) => {
        if (totals[key] === null) return null
        return finiteNonNegative(totals[key]) ?? undefined
    }
    const ctr = ratio("ctr"), cpc = ratio("cpc"), costPerLead = ratio("costPerLead")
    if (ctr === undefined || cpc === undefined || costPerLead === undefined) return null
    const daily = report.daily.flatMap((item): PortalMetaAdsDaily[] => {
        if (!item || typeof item !== "object") return []
        const row = item as Record<string, unknown>
        const rowSpend = finiteNonNegative(row.spend), rowImpressions = finiteNonNegative(row.impressions), rowClicks = finiteNonNegative(row.clicks), rowLeads = finiteNonNegative(row.leads)
        if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || rowSpend === null || rowImpressions === null || rowClicks === null || rowLeads === null) return []
        return [{ date: row.date, spend: rowSpend, impressions: rowImpressions, clicks: rowClicks, leads: rowLeads }]
    })
    if (daily.length !== report.daily.length) return null
    return {
        accountName: typeof report.accountName === "string" && report.accountName.trim() ? report.accountName.trim().slice(0, 200) : null,
        currency: typeof report.currency === "string" && /^[A-Z]{3}$/.test(report.currency) ? report.currency : null,
        fetchedAt: report.fetchedAt,
        period: "last_30d",
        totals: { spend, impressions, clicks, leads, ctr, cpc, costPerLead },
        daily,
    }
}
