"use client"

import { useEffect, useRef, useState } from "react"
import { FacebookLogo } from "@/components/brand/FacebookLogo"
import { createWindsorReturnMonitor } from "@/lib/onboarding/windsor-return"
import { RequestHelpLink } from "@/components/onboarding/RequestHelpLink"
import { Selector, Status } from "@/components/ui"
import type { ConnectionBlock } from "@/lib/onboarding/block-definition"
import type { PortalMetaAdsReport } from "@/lib/client-portal/meta-ads-report"

type Connection = {
    status: "pending" | "connected" | "needs_attention"
    accountId: string | null
    accountName: string | null
    datasource: string | null
    connectedAt: string | null
}

type Account = { id: string; name: string; datasource: string }

const primaryButton = "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--onboarding-primary)] px-5 py-3 text-center font-medium text-white shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--onboarding-primary)]/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"

function initialConnection(value: unknown): Connection | null {
    if (!value || typeof value !== "object") return null
    const record = value as Record<string, unknown>
    if (record.provider !== "windsor" || typeof record.accountId !== "string") return null
    return { status: "connected", accountId: record.accountId, accountName: typeof record.accountName === "string" ? record.accountName : null, datasource: "facebook_ads", connectedAt: typeof record.connectedAt === "string" ? record.connectedAt : null }
}

export function WindsorMetaAdsConnectionBlock({ block, token, sessionBlockId, initialResponse, locked, preview, satisfied, onSatisfied, onUnsatisfied }: {
    block: ConnectionBlock
    token: string
    sessionBlockId?: string
    initialResponse?: unknown
    locked: boolean
    preview: boolean
    satisfied: boolean
    onSatisfied: () => void
    onUnsatisfied: () => void
}) {
    const initial = initialConnection(initialResponse)
    const [connection, setConnection] = useState<Connection | null>(initial)
    const [accounts, setAccounts] = useState<Account[]>([])
    const [selectedAccount, setSelectedAccount] = useState("")
    const [reportPreview, setReportPreview] = useState<{ account: Account; report: PortalMetaAdsReport } | null>(null)
    const [confirmed, setConfirmed] = useState(false)
    const [loading, setLoading] = useState(!preview && !locked)
    const [pending, setPending] = useState(false)
    const [started, setStarted] = useState(false)
    const [recovery, setRecovery] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const popup = useRef<Window | null>(null)
    const begin = useRef<() => void>(() => undefined)
    const choose = useRef<(id: string, confirmed?: boolean) => void>(() => undefined)
    const selection = useRef<{ accountId?: string; confirmed: boolean }>({ confirmed: false })
    const callbacks = useRef({ onSatisfied, onUnsatisfied })
    useEffect(() => { callbacks.current = { onSatisfied, onUnsatisfied } }, [onSatisfied, onUnsatisfied])

    useEffect(() => {
        if (preview || locked || !sessionBlockId) return
        let cancelled = false
        let away = false
        let closeTimer: ReturnType<typeof setTimeout> | undefined
        let closeDeadline = 0
        selection.current = { confirmed: false }
        const controller = new AbortController()
        const endpoint = `/api/onboarding/session/${encodeURIComponent(token)}/windsor-meta-ads?block=${encodeURIComponent(sessionBlockId)}`
        async function request(method: "GET" | "POST") {
            const { accountId, confirmed: confirmAccount } = selection.current
            const response = await fetch(endpoint + (accountId ? `&account=${encodeURIComponent(accountId)}` : "") + (confirmAccount ? "&confirm=true" : ""), {
                method, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
            })
            const outcome = await response.json()
            if (!response.ok || !outcome.ok) throw new Error(outcome.error || "Your Meta Ads connection could not be confirmed.")
            return outcome
        }
        function stopCloseWatch() { if (closeTimer) clearTimeout(closeTimer); closeTimer = undefined }
        const monitor = createWindsorReturnMonitor({
            visible: () => document.visibilityState !== "hidden",
            settled: () => { if (!cancelled) { setPending(false); setRecovery(true) } },
            verify: async () => {
                setPending(true)
                setRecovery(false)
                setError(null)
                try {
                    const outcome = await request("POST")
                    if (cancelled) return "complete"
                    setConnection(outcome.connection)
                    setAccounts(outcome.accounts)
                    setReportPreview(outcome.preview ?? null)
                    if (outcome.satisfied) {
                        stopCloseWatch()
                        popup.current = null
                        setStarted(false)
                        setNotice(null)
                        callbacks.current.onSatisfied()
                        return "complete"
                    }
                    callbacks.current.onUnsatisfied()
                    setNotice(outcome.accounts.length > 0
                        ? outcome.preview ? "Review the report and confirm that this is your intended advertising account." : "Choose the Meta Ads account for this relationship."
                        : "Your account has not reached us yet. Finish in Windsor, then return here and we’ll confirm it automatically.")
                    return outcome.accounts.length > 0 ? "pause" : "retry"
                } catch (cause) {
                    if (!cancelled) setError(cause instanceof Error ? cause.message : "Your connection could not be confirmed. Please try again.")
                    return "pause"
                }
            },
        })
        function watchClose() {
            stopCloseWatch()
            if (cancelled || document.visibilityState === "hidden" || !popup.current) return
            if (popup.current.closed) {
                popup.current = null
                monitor.returned()
            } else if (Date.now() < closeDeadline) closeTimer = setTimeout(watchClose, 500)
        }
        function returned() {
            if (document.visibilityState === "hidden") { away = true; stopCloseWatch(); return }
            if (away) { away = false; monitor.returned() }
            watchClose()
        }
        function left() { away = true }
        begin.current = () => {
            selection.current = { confirmed: false }
            monitor.start()
            closeDeadline = Date.now() + 30 * 60_000
            watchClose()
        }
        choose.current = (id, confirmed = false) => { selection.current = { accountId: id || undefined, confirmed }; monitor.start(); monitor.returned() }
        window.addEventListener("blur", left)
        window.addEventListener("focus", returned)
        window.addEventListener("pageshow", returned)
        document.addEventListener("visibilitychange", returned)
        void (async () => {
            try {
                const outcome = await request("GET")
                if (cancelled) return
                setConnection(outcome.connection)
                if (outcome.satisfied) callbacks.current.onSatisfied()
                else {
                    callbacks.current.onUnsatisfied()
                    if (outcome.connection?.status === "pending") { setStarted(true); monitor.start(); monitor.returned() }
                }
            } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Your connection could not be loaded.") }
            finally { if (!cancelled) setLoading(false) }
        })()
        return () => {
            cancelled = true
            controller.abort()
            monitor.dispose()
            stopCloseWatch()
            begin.current = () => undefined
            choose.current = () => undefined
            window.removeEventListener("blur", left)
            window.removeEventListener("focus", returned)
            window.removeEventListener("pageshow", returned)
            document.removeEventListener("visibilitychange", returned)
        }
    }, [token, sessionBlockId, preview, locked])

    function openConnection(restart = false) {
        if (loading || pending || locked) return
        if (preview) {
            setConnection({ status: "connected", accountId: "act_123456789", accountName: "Example Meta Ads account", datasource: "facebook_ads", connectedAt: new Date().toISOString() })
            callbacks.current.onSatisfied()
            return
        }
        if (!sessionBlockId) return
        if (popup.current && !popup.current.closed) { popup.current.focus(); return }
        if (started && !restart) { choose.current(""); return }
        setError(null)
        setRecovery(false)
        setAccounts([])
        setSelectedAccount("")
        setReportPreview(null)
        setConfirmed(false)
        setStarted(true)
        setNotice("Select your Meta Ads account in Windsor and press Finish. Close that window to return here, then review the account and report before confirming.")
        // Open synchronously with the click, before any request, for Safari and
        // mobile popup rules. Isolate the provider from the onboarding opener.
        const child = window.open("about:blank", "_blank", "popup=yes,width=680,height=780")
        if (child) {
            child.opener = null
            popup.current = child
            child.location.replace(startHref!)
            begin.current()
        } else { begin.current(); window.location.assign(startHref!) }
    }

    const connected = satisfied && connection?.status === "connected"
    const startHref = preview || !sessionBlockId ? undefined : `/api/onboarding/session/${encodeURIComponent(token)}/windsor-meta-ads/start?block=${encodeURIComponent(sessionBlockId)}`
    return <div className="rounded-2xl border border-black/10 bg-[var(--onboarding-page)] p-4 text-left sm:p-5" aria-busy={loading || pending}>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-semibold text-[var(--onboarding-text)]">Meta Ads reporting</p>{connected ? <Status label="Connected" tone="green" surface="light" /> : connection ? <Status label="Connection started" tone="yellow" surface="light" /> : null}</div>
        <p className="mt-2 text-sm leading-6 text-[var(--onboarding-muted)]">{block.description || "Connect the Meta Ads account that runs your campaigns so your results can appear in the client portal."}</p>
        {connected ? <div className="mt-4 flex items-center gap-3"><span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-lg font-bold text-white">f</span><div className="min-w-0"><p className="break-words font-medium text-[var(--onboarding-text)]">{connection.accountName || "Meta Ads account"}</p><p className="break-all text-sm text-[var(--onboarding-muted)]">{connection.accountId?.replace(/^act_/, "")}</p></div></div>
        : locked ? <p className="mt-4 text-sm text-[var(--onboarding-muted)]">This step has been submitted.</p>
        : <div className="mt-4 space-y-3">
            {accounts.length > 0 ? <div>
                <label className="block text-sm font-medium text-[var(--onboarding-text)]">Advertising account<Selector appearance="input" surface="light" ariaLabel="Advertising account" value={selectedAccount} disabled={pending} onChange={value => { selection.current = { accountId: value || undefined, confirmed: false }; setSelectedAccount(value); setReportPreview(null); setConfirmed(false); if (value) choose.current(value) }} options={[{ value: "", label: "Choose an account" }, ...accounts.map(account => ({ value: account.id, label: `${account.name} · ${account.id.replace(/^act_/, "")}` }))]} /></label>
            </div> : <button type="button" disabled={loading || pending} onClick={() => openConnection()} className={primaryButton}><FacebookLogo />{loading ? "Loading…" : pending ? "Confirming connection…" : recovery ? "Try again" : started ? "Continue in Windsor ↗" : block.label}</button>}
            {reportPreview ? <div className="space-y-3 border-t border-black/10 pt-3 text-sm text-[var(--onboarding-text)]"><p className="font-medium">{reportPreview.account.name} · {reportPreview.account.id}</p><p>{reportPreview.report.dateFrom} – {reportPreview.report.dateTo} · {reportPreview.report.currency ?? "No currency reported"}</p><p>Spend {reportPreview.report.totals.spend.toLocaleString()} · Clicks {reportPreview.report.totals.clicks.toLocaleString()} · Leads {reportPreview.report.totals.leads.toLocaleString()}</p><p className="text-xs text-[var(--onboarding-muted)]">No activity can be valid. Check that the name and account ID match the account running your campaigns.</p><label className="flex items-start gap-3"><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />This is the advertising account for my business.</label><button type="button" disabled={!confirmed || pending} onClick={() => choose.current(reportPreview.account.id, true)} className={primaryButton}>{pending ? "Verifying…" : "Confirm reporting account"}</button></div> : null}
            {recovery && started ? <button type="button" disabled={pending} onClick={() => openConnection(true)} className="block text-sm underline text-[var(--onboarding-muted)]">Start a new connection</button> : null}
            {!started ? <p className="text-sm leading-6 text-[var(--onboarding-muted)]">Select your account and press <strong>Finish</strong> in Windsor. Review the account and report here when you return.</p> : null}
        </div>}
        {preview ? <p className="mt-3 text-xs text-[var(--onboarding-muted)]">Preview only. No account will be contacted.</p> : null}
        {notice ? <p role="status" className="mt-4 text-sm leading-6 text-[var(--onboarding-muted)]">{notice}</p> : null}
        {error ? <p role="alert" className="mt-4 text-sm leading-6 text-red-700">{error} <RequestHelpLink />.</p> : null}
    </div>
}
