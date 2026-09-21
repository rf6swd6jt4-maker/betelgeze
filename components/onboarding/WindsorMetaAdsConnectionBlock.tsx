"use client"

import { useEffect, useRef, useState } from "react"
import { FacebookLogo } from "@/components/brand/FacebookLogo"
import { createWindsorReturnMonitor } from "@/lib/onboarding/windsor-return"
import { RequestHelpLink } from "@/components/onboarding/RequestHelpLink"
import { Status } from "@/components/ui"
import type { ConnectionBlock } from "@/lib/onboarding/block-definition"

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
    const [loading, setLoading] = useState(!preview && !locked)
    const [pending, setPending] = useState(false)
    const [started, setStarted] = useState(false)
    const [recovery, setRecovery] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const popup = useRef<Window | null>(null)
    const begin = useRef<() => void>(() => undefined)
    const choose = useRef<(id: string) => void>(() => undefined)
    const callbacks = useRef({ onSatisfied, onUnsatisfied })
    useEffect(() => { callbacks.current = { onSatisfied, onUnsatisfied } }, [onSatisfied, onUnsatisfied])

    useEffect(() => {
        if (preview || locked || !sessionBlockId) return
        let cancelled = false
        let away = false
        let closeTimer: ReturnType<typeof setTimeout> | undefined
        let closeDeadline = 0
        let accountId: string | undefined
        const controller = new AbortController()
        const endpoint = `/api/onboarding/session/${encodeURIComponent(token)}/windsor-meta-ads?block=${encodeURIComponent(sessionBlockId)}`
        async function request(method: "GET" | "POST") {
            const response = await fetch(endpoint + (accountId ? `&account=${encodeURIComponent(accountId)}` : ""), {
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
                    if (outcome.satisfied) {
                        stopCloseWatch()
                        popup.current = null
                        setStarted(false)
                        setNotice(null)
                        callbacks.current.onSatisfied()
                        return "complete"
                    }
                    callbacks.current.onUnsatisfied()
                    setNotice(outcome.accounts.length > 1
                        ? "Choose the Meta Ads account for this relationship."
                        : "Your account has not reached us yet. Finish in Windsor, then return here and we’ll confirm it automatically.")
                    return outcome.accounts.length > 1 ? "pause" : "retry"
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
            monitor.start()
            closeDeadline = Date.now() + 30 * 60_000
            watchClose()
        }
        choose.current = (id) => { accountId = id; monitor.start(); monitor.returned() }
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
        setStarted(true)
        setNotice("Select your Meta Ads account in Windsor and press Finish. Close that window to return here; your connection will be confirmed automatically.")
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
            {accounts.length > 1 ? <div>
                <label htmlFor={`windsor-account-${block.id}`} className="block text-sm font-medium text-[var(--onboarding-text)]">Advertising account</label>
                <select id={`windsor-account-${block.id}`} value={selectedAccount} disabled={pending} onChange={(event) => { setSelectedAccount(event.target.value); if (event.target.value) choose.current(event.target.value) }} className="mt-2 min-h-12 w-full rounded-xl border border-black/20 bg-[var(--onboarding-surface)] px-4 text-base text-[var(--onboarding-text)]">
                    <option value="">Choose an account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.id.replace(/^act_/, "")}</option>)}
                </select>
            </div> : <button type="button" disabled={loading || pending} onClick={() => openConnection()} className={primaryButton}><FacebookLogo />{loading ? "Loading…" : pending ? "Confirming connection…" : recovery ? "Try again" : started ? "Continue in Windsor ↗" : block.label}</button>}
            {recovery && started ? <button type="button" disabled={pending} onClick={() => openConnection(true)} className="block text-sm underline text-[var(--onboarding-muted)]">Start a new connection</button> : null}
            {!started ? <p className="text-sm leading-6 text-[var(--onboarding-muted)]">Select your account and press <strong>Finish</strong> in Windsor. Your connection will be confirmed automatically when you return.</p> : null}
        </div>}
        {preview ? <p className="mt-3 text-xs text-[var(--onboarding-muted)]">Preview only. No account will be contacted.</p> : null}
        {notice ? <p role="status" className="mt-4 text-sm leading-6 text-[var(--onboarding-muted)]">{notice}</p> : null}
        {error ? <p role="alert" className="mt-4 text-sm leading-6 text-red-700">{error} <RequestHelpLink />.</p> : null}
    </div>
}
