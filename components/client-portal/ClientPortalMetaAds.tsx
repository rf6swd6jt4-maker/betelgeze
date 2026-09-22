"use client"

import { useEffect, useMemo, useState } from "react"
import { ClientPortalReport } from "@/components/client-portal/ClientPortalReport"
import { PortalSection } from "@/components/client-portal/ClientPortalUI"
import { TrendChart, type TrendChartPoint } from "@/components/ui/TrendChart"
import { portalMetaAdsReport, type PortalMetaAdsDaily, type PortalMetaAdsReport } from "@/lib/client-portal/meta-ads-report"

export type ClientPortalMetaAdsReporting = {
    accountId: string
    accountName: string | null
}

function formatNumber(value: number) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

function formatMoney(value: number, currency: string | null, compact = false) {
    if (!currency) return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, notation: compact ? "compact" : "standard" }).format(value)
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: value < 100 ? 2 : 0, notation: compact ? "compact" : "standard" }).format(value)
}

function shortDate(value: string) {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`))
}

function points(rows: PortalMetaAdsDaily[], metric: "spend" | "clicks", currency: string | null): TrendChartPoint[] {
    return rows.map((row, position) => ({
        id: `${metric}-${row.date}`,
        position,
        value: row[metric],
        ariaLabel: `${shortDate(row.date)}: ${metric === "spend" ? formatMoney(row.spend, currency) : formatNumber(row.clicks)} ${metric}`,
        tooltipLabel: shortDate(row.date),
        tooltipValue: metric === "spend" ? formatMoney(row.spend, currency) : `${formatNumber(row.clicks)} clicks`,
    }))
}

function MetricChart({ title, rows, metric, currency }: { title: string; rows: PortalMetaAdsDaily[]; metric: "spend" | "clicks"; currency: string | null }) {
    const chartPoints = points(rows, metric, currency)
    const maximum = Math.max(1, ...chartPoints.map((point) => point.value))
    const first = rows[0]?.date
    const last = rows.at(-1)?.date
    return <div className="min-w-0 rounded-2xl border border-black/10 bg-white p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-[var(--onboarding-text,#0F172A)]">{title}</h3>
        <div className="mt-3"><TrendChart ariaLabel={`${title} over the last 30 days`} points={chartPoints} domainEnd={Math.max(1, rows.length - 1)} min={0} max={maximum} ticks={[{ id: "zero", value: 0, label: metric === "spend" ? formatMoney(0, currency, true) : "0" }, { id: "maximum", value: maximum, label: metric === "spend" ? formatMoney(maximum, currency, true) : formatNumber(maximum) }]} labels={first && last ? [{ id: "start", position: 0, label: shortDate(first), anchor: "start" }, { id: "end", position: rows.length - 1, label: shortDate(last), anchor: "end" }] : []} surface="light" reveal /></div>
    </div>
}

export function ClientPortalMetaAds({ token, reporting }: { token: string; reporting: ClientPortalMetaAdsReporting }) {
    const [report, setReport] = useState<PortalMetaAdsReport | null>(null)
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
    const [attempt, setAttempt] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        fetch(`/api/client-portal/session/${encodeURIComponent(token)}/meta-ads`, { cache: "no-store", signal: controller.signal })
            .then(async (response) => {
                const payload = await response.json().catch(() => null) as { report?: unknown } | null
                const parsed = response.ok ? portalMetaAdsReport(payload?.report) : null
                if (!parsed) throw new Error("invalid-report")
                setReport(parsed)
                setStatus("ready")
            })
            .catch((error: unknown) => {
                if (!(error instanceof DOMException && error.name === "AbortError")) setStatus("error")
            })
        return () => controller.abort()
    }, [attempt, token])

    const summary = useMemo(() => report ? [
        { label: "Spend", value: formatMoney(report.totals.spend, report.currency) },
        { label: "Clicks", value: formatNumber(report.totals.clicks) },
        { label: "Leads", value: formatNumber(report.totals.leads) },
    ] : [], [report])

    const metrics = useMemo(() => report ? [
        { label: "Impressions", value: formatNumber(report.totals.impressions) },
        { label: "Click-through rate", value: report.totals.ctr === null ? "—" : `${report.totals.ctr.toFixed(1)}%` },
        { label: "Average cost per click", value: report.totals.cpc === null ? "—" : formatMoney(report.totals.cpc, report.currency) },
        { label: "Average cost per lead", value: report.totals.costPerLead === null ? "—" : formatMoney(report.totals.costPerLead, report.currency) },
    ] : [], [report])

    return <PortalSection id="meta-ads-reporting" title="Meta Ads" description="Advertising results" icon="chart">
        {status === "loading" ? <div className="flex min-h-64 flex-1 items-center justify-center text-center"><div><div aria-hidden="true" className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-black/10 border-t-[var(--onboarding-primary,#1E3A5F)]" /><p className="mt-4 text-sm text-[var(--onboarding-muted,#475569)]">Loading the last 30 days…</p></div></div> : null}
        {status === "error" ? <div className="flex min-h-64 flex-1 items-center justify-center px-4 text-center"><div><h3 className="text-base font-semibold">Metrics could not be loaded</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Your reporting connection is still in place. Please try again.</p><button type="button" onClick={() => { setStatus("loading"); setAttempt((value) => value + 1) }} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)] shadow-sm hover:bg-black/[0.03]">Try again</button></div></div> : null}
        {status === "ready" && report ? <ClientPortalReport
            title="Campaign performance"
            periodLabel="Last 30 days"
            updatedAt={report.fetchedAt}
            accountName={report.accountName || reporting.accountName}
            stats={summary}
            metrics={metrics}
            emptyMessage={report.totals.impressions === 0 && report.totals.clicks === 0 && report.totals.spend === 0 && report.totals.leads === 0 ? "Meta reported no activity for this period." : null}
            note="Figures may update as Meta processes activity."
        >
            <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold text-[var(--onboarding-text,#0F172A)]">Daily performance</h3><p className="text-xs text-[var(--onboarding-muted,#475569)]">Hover or tap a day for its exact value.</p></div>
            <div className="mt-3 grid gap-4 lg:grid-cols-2"><MetricChart title="Daily spend" rows={report.daily} metric="spend" currency={report.currency} /><MetricChart title="Daily clicks" rows={report.daily} metric="clicks" currency={report.currency} /></div>
        </ClientPortalReport> : null}
    </PortalSection>
}
