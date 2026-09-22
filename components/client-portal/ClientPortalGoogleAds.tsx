"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { GoogleAdsConnection, adsFetch, adsPrimary, adsSecondary } from "@/components/google-ads/GoogleAdsConnection"
import { ClientPortalReport, type ClientPortalReportMetric } from "./ClientPortalReport"
import { ClientPortalDisconnect } from "./ClientPortalDisconnect"
import { PortalSection } from "./ClientPortalUI"
import { Selector } from "@/components/ui"
import { googleAdsPeriods, isGoogleAdsReportKind, type GoogleAdsPeriod, type GoogleAdsReportKind, type GoogleAdsReportSnapshot } from "@/lib/google-ads-report"
import type { GoogleAdsOnboardingConnection } from "@/lib/onboarding/google-ads-state"

const reportLabels: Record<GoogleAdsReportKind, string> = { search: "Google Search Ads", local_services: "Google Local Services Ads" }

function Reports({ api, active, kind }: { api: string; active: boolean; kind: GoogleAdsReportKind }) {
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
            const value = await adsFetch(api, { action: "refresh", period: selected, kind })
            if (mounted.current) save(selected, value.snapshot)
        } catch (e) { if (mounted.current && generation.current === current) setError(e instanceof Error && e.name !== "TimeoutError" ? e.message : "The report took too long. Reload its saved status before trying again.") }
        finally { refreshBusy.current = false; if (mounted.current) setPending(false) }
    }, [api, kind, save])
    useEffect(() => {
        if (!active || period in cache.current) return
        let cancelled = false
        const controller = new AbortController(), current = ++generation.current
        setReading(true); setError(null)
        void adsFetch(`${api}?period=${period}&kind=${kind}`, undefined, controller.signal).then((value) => {
            if (cancelled || generation.current !== current) return
            save(period, value.snapshot); setError(value.error ?? null)
            if (firstLoad.current && !value.snapshot && !value.busy && !value.error) { firstLoad.current = false; void refresh(period) }
            else firstLoad.current = false
        }).catch((e) => { if (!cancelled && generation.current === current) setError(e instanceof Error ? e.message : "The report could not be loaded.") }).finally(() => { if (!cancelled) setReading(false) })
        return () => { cancelled = true; controller.abort() }
    }, [api, period, kind, active, save, refresh])
    const snapshot = snapshots[period], report = snapshot?.report
    const money = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: report?.currency || "USD", currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(value)
    const count = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    const stats = report?.kind === "search"
        ? [{ label: "Spend", value: money(report.spend) }, { label: "Clicks", value: count(report.clicks) }, { label: "Conversions", value: count(report.conversions) }]
        : report?.kind === "local_services"
            ? [{ label: "Spend", value: money(report.spend) }, { label: "Leads", value: count(report.leads) }, { label: "Charged", value: count(report.chargedLeads) }]
            : []
    const metrics: ClientPortalReportMetric[] = report?.kind === "search" ? [
        { label: "Impressions", value: count(report.impressions) },
        { label: "Click-through rate", value: report.impressions ? `${(report.clicks / report.impressions * 100).toFixed(1)}%` : "—" },
        { label: "Average cost per click", value: report.clicks ? money(report.spend / report.clicks) : "—" },
        { label: "Average cost per conversion", value: report.costPerConversion === null ? "—" : money(report.costPerConversion) },
    ] : report?.kind === "local_services" ? [
        { label: "Calls", value: count(report.phoneLeads) },
        { label: "Messages", value: count(report.messageLeads) },
        { label: "Bookings", value: count(report.bookingLeads) },
        { label: "Marked booked", value: count(report.bookedLeads) },
        { label: "Credited", value: count(report.creditedLeads) },
        { label: "Average cost per lead", value: report.costPerLead === null ? "—" : money(report.costPerLead) },
    ] : []
    const emptyMessage = report?.kind === "search" && report.impressions === 0 && report.clicks === 0 && report.spend === 0 && report.conversions === 0
        ? "Google reported no activity for this period."
        : report?.kind === "local_services" && report.leads === 0 && report.spend === 0
            ? "Google reported no Local Services activity for this period."
            : null
    const periodControl = <label className="flex items-center gap-2 text-sm font-medium"><span className="sr-only">Reporting period</span><select aria-label="Reporting period" value={period} onChange={(event) => { setError(null); setPeriod(event.target.value as GoogleAdsPeriod) }} className="min-h-11 rounded-lg border border-black/15 bg-white px-3 text-sm">{Object.entries(googleAdsPeriods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    return <ClientPortalReport
        title={reportLabels[kind]}
        periodLabel={report ? `${report.startDate} – ${report.endDate}` : googleAdsPeriods[period]}
        updatedAt={snapshot?.refreshedAt}
        stats={stats}
        metrics={metrics}
        controls={periodControl}
        emptyMessage={emptyMessage}
        note={report ? <>{report.timeZone} <span aria-hidden="true">·</span> {report.currency}. {report.kind === "search" ? "Conversions are the actions counted in Google Ads, not confirmed appointments. Figures may update as Google processes activity." : "Lead status and credits may update after the original enquiry."}</> : null}
    >
        {!report ? <p role="status" className="mt-4 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">{reading ? "Loading saved report…" : pending ? "Loading your results from Google Ads…" : "No report loaded for this period yet."}</p> : null}
        {error ? <p role="alert" className="mt-3 text-sm leading-6 text-red-700">{error}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={adsPrimary} disabled={pending || reading} onClick={() => void refresh(period)}>{pending ? "Refreshing…" : report ? "Refresh metrics" : "Load metrics"}</button>{error ? <button type="button" className={adsSecondary} disabled={pending || reading} onClick={() => { delete cache.current[period]; setPeriod(period); setSnapshots({ ...cache.current }); void adsFetch(`${api}?period=${period}&kind=${kind}`).then((value) => { save(period, value.snapshot); setError(null) }).catch(() => setError("The saved report could not be loaded. Please try again.")) }}>Reload status</button> : null}</div>
    </ClientPortalReport>
}
export function ClientPortalGoogleAds({ token, active }: { token: string; active: boolean }) {
    const [account, setAccount] = useState<string | null>(null)
    const [reportKinds, setReportKinds] = useState<GoogleAdsReportKind[]>(["search"]), [reportKind, setReportKind] = useState<GoogleAdsReportKind>("search")
    const [hasConnection, setHasConnection] = useState(false), [revision, setRevision] = useState(0), [disconnecting, setDisconnecting] = useState(false), [disconnectError, setDisconnectError] = useState("")
    const disconnectBusy = useRef(false)
    const api = `/api/client-portal/session/${token}/connections/google-ads`
    const onState = useCallback((connection: GoogleAdsOnboardingConnection | null, satisfied: boolean, details?: { reportKinds?: string[] }) => {
        setHasConnection(Boolean(connection)); setAccount(satisfied && connection ? `${connection.managerId}:${connection.customerId}` : null)
        const kinds = details?.reportKinds?.filter(isGoogleAdsReportKind)
        if (kinds?.length) { setReportKinds(kinds); setReportKind((current) => kinds.includes(current) ? current : kinds[0]) }
    }, [])
    async function disconnect() {
        if (disconnectBusy.current) return
        disconnectBusy.current = true; setDisconnecting(true); setDisconnectError("")
        try {
            await adsFetch(api, { action: "disconnect" })
            setAccount(null); setHasConnection(false); setRevision(value => value + 1)
        } catch (error) { setDisconnectError(error instanceof Error ? error.message : "The account could not be disconnected. Please retry.") }
        finally { disconnectBusy.current = false; setDisconnecting(false) }
    }
    return <PortalSection id="google-ads-connection" title="Google Ads" description="Advertising results" icon="connection"><div className="mt-4"><GoogleAdsConnection key={revision} api={api} active={active} onState={onState} />{account ? <>{reportKinds.length > 1 ? <div className="mt-5"><Selector surface="light" appearance="input" ariaLabel="Google Ads service results" value={reportKind} options={reportKinds.map((kind) => ({ value: kind, label: reportLabels[kind] }))} onChange={(value) => { if (isGoogleAdsReportKind(value)) setReportKind(value) }} /></div> : null}<Reports key={`${account}:${reportKind}`} api={api} active={active} kind={reportKind} /></> : null}{hasConnection ? <div className="mt-4"><ClientPortalDisconnect confirmation="Disconnect Google Ads from this portal? Its saved results will be cleared. Your agency’s access in Google Ads will remain." pending={disconnecting} onDisconnect={() => void disconnect()} /></div> : null}{disconnectError ? <p role="alert" className="mt-3 text-sm leading-6 text-red-700">{disconnectError}</p> : null}</div></PortalSection>
}
