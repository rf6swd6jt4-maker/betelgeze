"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { GoogleAdsConnection, adsFetch, adsPrimary, adsSecondary } from "@/components/google-ads/GoogleAdsConnection"
import { QuickStats } from "@/components/panel/QuickStats"
import { PortalSection } from "./ClientPortalUI"
import { googleAdsPeriods, type GoogleAdsPeriod, type GoogleAdsReportSnapshot } from "@/lib/google-ads-report"
import type { GoogleAdsOnboardingConnection } from "@/lib/onboarding/google-ads-state"

function Reports({ api, active }: { api: string; active: boolean }) {
    const [period, setPeriod] = useState<GoogleAdsPeriod>("last30")
    const [snapshots, setSnapshots] = useState<Partial<Record<GoogleAdsPeriod, GoogleAdsReportSnapshot | null>>>({})
    const [error, setError] = useState<string | null>(null), [reading, setReading] = useState(false), [pending, setPending] = useState(false)
    const cache = useRef(snapshots), mounted = useRef(true), refreshBusy = useRef(false), generation = useRef(0), firstLoad = useRef(true)
    useEffect(() => { const counter = generation; mounted.current = true; return () => { mounted.current = false; counter.current++ } }, [])
    const save = useCallback((key: GoogleAdsPeriod, snapshot: GoogleAdsReportSnapshot | null) => {
        cache.current = { ...cache.current, [key]: snapshot }; setSnapshots(cache.current)
    }, [])
    const refresh = useCallback(async (selected: GoogleAdsPeriod) => {
        if (refreshBusy.current) return
        refreshBusy.current = true; setPending(true); setError(null)
        const current = ++generation.current
        try {
            const value = await adsFetch(api, { action: "refresh", period: selected })
            if (mounted.current) save(selected, value.snapshot)
        } catch (e) { if (mounted.current && generation.current === current) setError(e instanceof Error && e.name !== "TimeoutError" ? e.message : "The report took too long. Reload its saved status before trying again.") }
        finally { refreshBusy.current = false; if (mounted.current) setPending(false) }
    }, [api, save])
    useEffect(() => {
        if (!active || period in cache.current) return
        let cancelled = false
        const controller = new AbortController(), current = ++generation.current
        setReading(true); setError(null)
        void adsFetch(`${api}?period=${period}`, undefined, controller.signal).then((value) => {
            if (cancelled || generation.current !== current) return
            save(period, value.snapshot); setError(value.error ?? null)
            if (firstLoad.current && !value.snapshot && !value.busy && !value.error) { firstLoad.current = false; void refresh(period) }
            else firstLoad.current = false
        }).catch((e) => { if (!cancelled && generation.current === current) setError(e instanceof Error ? e.message : "The report could not be loaded.") }).finally(() => { if (!cancelled) setReading(false) })
        return () => { cancelled = true; controller.abort() }
    }, [api, period, active, save, refresh])
    const snapshot = snapshots[period], report = snapshot?.report
    const money = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: report!.currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(value)
    const count = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    return <div className="mt-5 border-t border-black/10 pt-4">
        <label className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">Reporting period<select value={period} onChange={(e) => { setError(null); setPeriod(e.target.value as GoogleAdsPeriod) }} className="min-h-11 rounded-lg border border-black/15 bg-white px-3 text-sm">{Object.entries(googleAdsPeriods).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {report ? <>
            <QuickStats surface="light" ariaLabel="Google Ads performance" items={[{ label: "Spend", value: <span className="text-xs min-[380px]:text-sm sm:text-lg" title={money(report.spend)}>{money(report.spend)}</span> }, { label: "Clicks", value: count(report.clicks) }, { label: "Conversions", value: count(report.conversions) }]} />
            <p className="mt-3 text-sm leading-6"><strong>{count(report.impressions)}</strong> impressions <span aria-hidden="true">·</span> <strong>{report.costPerConversion === null ? "—" : money(report.costPerConversion)}</strong> per conversion</p>
            <p className="mt-2 text-xs leading-5 text-[var(--onboarding-muted,#475569)]">{report.startDate} – {report.endDate} · {report.timeZone} · {report.currency}. Includes today so far.</p>
            {report.impressions === 0 && report.clicks === 0 && report.spend === 0 && report.conversions === 0 ? <p className="mt-2 text-sm">Google reported no activity for this period.</p> : null}
            <p className="mt-2 text-xs leading-5 text-[var(--onboarding-muted,#475569)]">Conversions are the actions counted in Google Ads, not confirmed appointments. Figures may update as Google processes activity.</p>
            <p className="mt-2 text-xs text-[var(--onboarding-muted,#475569)]">Updated {new Date(snapshot!.refreshedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.</p>
        </> : <p role="status" className="mt-4 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">{reading ? "Loading saved report…" : pending ? "Loading your results from Google Ads…" : "No report loaded for this period yet."}</p>}
        {error ? <p role="alert" className="mt-3 text-sm leading-6 text-red-700">{error}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={adsPrimary} disabled={pending || reading} onClick={() => void refresh(period)}>{pending ? "Refreshing…" : report ? "Refresh metrics" : "Load metrics"}</button>{error ? <button type="button" className={adsSecondary} disabled={pending || reading} onClick={() => { delete cache.current[period]; setPeriod(period); setSnapshots({ ...cache.current }); void adsFetch(`${api}?period=${period}`).then((value) => { save(period, value.snapshot); setError(null) }).catch(() => setError("The saved report could not be loaded. Please try again.")) }}>Reload status</button> : null}</div>
    </div>
}
export function ClientPortalGoogleAds({ token, active }: { token: string; active: boolean }) {
    const [account, setAccount] = useState<string | null>(null)
    const api = `/api/client-portal/session/${token}/connections/google-ads`
    const onState = useCallback((connection: GoogleAdsOnboardingConnection | null, satisfied: boolean) => { setAccount(satisfied && connection ? `${connection.managerId}:${connection.customerId}` : null) }, [])
    return <PortalSection id="google-ads-connection" title="Google Ads" description="Advertising results" icon="connection"><div className="mt-4"><GoogleAdsConnection api={api} active={active} onState={onState} />{account ? <Reports key={account} api={api} active={active} /> : null}</div></PortalSection>
}
