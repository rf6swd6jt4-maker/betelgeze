"use client"

import { useEffect, useMemo, useState } from "react"
import { PortalSection } from "@/components/client-portal/ClientPortalUI"
import { QuickStats } from "@/components/panel/QuickStats"
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
    return <div className="rounded-2xl border border-black/10 bg-white p-4 sm:p-5">
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

    return <PortalSection id="meta-ads-reporting" title="Meta Ads" description={reporting.accountName || "Campaign performance"} icon="chart">
        {status === "loading" ? <div className="flex min-h-64 flex-1 items-center justify-center text-center"><div><div aria-hidden="true" className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-black/10 border-t-[var(--onboarding-primary,#1E3A5F)]" /><p className="mt-4 text-sm text-[var(--onboarding-muted,#475569)]">Loading the last 30 days…</p></div></div> : null}
        {status === "error" ? <div className="flex min-h-64 flex-1 items-center justify-center px-4 text-center"><div><h3 className="text-base font-semibold">Metrics could not be loaded</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Your reporting connection is still in place. Please try again.</p><button type="button" onClick={() => { setStatus("loading"); setAttempt((value) => value + 1) }} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)] shadow-sm hover:bg-black/[0.03]">Try again</button></div></div> : null}
        {status === "ready" && report ? <div className="min-h-0 flex-1">
            <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wider text-[var(--onboarding-muted,#475569)]">Last 30 days</p><p className="mt-1 text-sm text-[var(--onboarding-muted,#475569)]">Updated {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.fetchedAt))}</p></div>{report.accountName ? <p className="max-w-full truncate text-sm font-medium">{report.accountName}</p> : null}</div>
            <QuickStats surface="light" ariaLabel="Meta Ads summary" items={summary} />
            <p className="mt-4 text-sm text-[var(--onboarding-muted,#475569)]">{formatNumber(report.totals.impressions)} impressions · {report.totals.ctr === null ? "—" : `${report.totals.ctr.toFixed(1)}%`} CTR · {report.totals.cpc === null ? "—" : formatMoney(report.totals.cpc, report.currency)} average cost per click</p>
            <div className="mt-5 grid gap-4 lg:grid-cols-2"><MetricChart title="Daily spend" rows={report.daily} metric="spend" currency={report.currency} /><MetricChart title="Daily clicks" rows={report.daily} metric="clicks" currency={report.currency} /></div>
        </div> : null}
    </PortalSection>
}
