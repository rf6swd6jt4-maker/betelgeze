"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { connectOnboardingGoogleAds, getGoogleAdsOnboarding } from "@/app/onboarding/session/[token]/google-ads-actions"
import { GoogleAdsLogo } from "@/components/brand/GoogleAdsLogo"
import { RequestHelpLink } from "@/components/onboarding/RequestHelpLink"
import { Status } from "@/components/ui"
import type { ConnectionBlock } from "@/lib/onboarding/block-definition"
import { formatGoogleAdsCustomerId, googleAdsOnboardingResponse } from "@/lib/onboarding/google-ads-state"

const primaryButton = "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--onboarding-primary)] px-5 py-3 text-center font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
const secondaryButton = "inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-[var(--onboarding-primary)] px-5 py-3 text-center font-medium text-[var(--onboarding-primary)] disabled:opacity-50 sm:w-auto"

type Props = {
    block: ConnectionBlock
    token: string
    sessionBlockId?: string
    initialResponse?: unknown
    locked: boolean
    preview: boolean
    satisfied: boolean
    onSatisfied: () => void
    onUnsatisfied: () => void
}

export function GoogleAdsConnectionBlock({ block, token, sessionBlockId, initialResponse, locked, preview, satisfied, onSatisfied, onUnsatisfied }: Props) {
    const initial = googleAdsOnboardingResponse(initialResponse)
    const [connection, setConnection] = useState(initial)
    const [customerId, setCustomerId] = useState(initial?.customerId ?? "")
    const [manager, setManager] = useState({ id: initial?.managerId ?? "", name: initial?.managerName ?? "Your agency" })
    const [expanded, setExpanded] = useState(Boolean(initial))
    const [consented, setConsented] = useState(false)
    const [loading, setLoading] = useState(!preview && !locked)
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [reload, setReload] = useState(0)
    const callbacks = useRef({ onSatisfied, onUnsatisfied })
    useEffect(() => { callbacks.current = { onSatisfied, onUnsatisfied } }, [onSatisfied, onUnsatisfied])

    useEffect(() => {
        if (preview || locked || !sessionBlockId) return
        let cancelled = false
        startTransition(async () => {
            try {
                const outcome = await getGoogleAdsOnboarding(token, sessionBlockId)
                if (cancelled) return
                if (!outcome.ok) { setError(outcome.error); return }
                setManager({ id: outcome.managerId, name: outcome.managerName })
                setConnection(outcome.connection)
                if (outcome.connection) { setCustomerId(outcome.connection.customerId); setExpanded(true) }
                if (outcome.satisfied) callbacks.current.onSatisfied()
                else callbacks.current.onUnsatisfied()
            } catch { if (!cancelled) setError("Your connection could not be loaded. Check your internet connection and try again.") }
            finally { if (!cancelled) setLoading(false) }
        })
        return () => { cancelled = true }
    }, [token, sessionBlockId, preview, locked, reload])

    function connect(action: "request" | "verify") {
        if (locked || pending || loading) return
        setError(null)
        setNotice(null)
        startTransition(async () => {
            try {
                if (preview) {
                    setConnection({ customerId: customerId.replace(/[-\s]/g, "") || "1234567890", managerId: "9876543210", managerName: "Your agency", status: action === "verify" ? "connected" : "pending", accountName: action === "verify" ? "Example advertising account" : null, verifiedAt: action === "verify" ? new Date().toISOString() : null })
                    setManager({ id: "9876543210", name: "Your agency" })
                    if (action === "verify") callbacks.current.onSatisfied()
                    return
                }
                if (!sessionBlockId) throw new Error("This connection block is unavailable. Refresh your onboarding page.")
                const outcome = await connectOnboardingGoogleAds(token, sessionBlockId, customerId, action)
                if (!outcome.ok) { callbacks.current.onUnsatisfied(); setError(outcome.error); return }
                setConnection(outcome.connection)
                setCustomerId(outcome.connection.customerId)
                setManager({ id: outcome.connection.managerId, name: outcome.connection.managerName })
                if (outcome.connection.status === "connected") callbacks.current.onSatisfied()
                else {
                    callbacks.current.onUnsatisfied()
                    if (action === "verify") setNotice("Approval is still pending. Confirm the request in Google Ads, then check again. If you just approved it, allow a moment for Google to update.")
                }
            } catch {
                callbacks.current.onUnsatisfied()
                setError("The connection could not be checked. Check your internet connection, then try again. Your saved request will still be here.")
            }
        })
    }

    const connected = satisfied && connection?.status === "connected"
    const awaitingApproval = connection?.status === "pending" || (connection?.status === "connected" && !satisfied)
    return <div className="rounded-2xl border border-black/10 bg-[var(--onboarding-page)] p-4 text-left sm:p-5" aria-busy={pending || loading}>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-semibold text-[var(--onboarding-text)]">Google Ads</p>{connected ? <Status label="Connected" tone="green" surface="light" /> : awaitingApproval ? <Status label="Awaiting verification" tone="yellow" surface="light" /> : null}</div>
        {block.description ? <p className="mt-2 text-sm leading-6 text-[var(--onboarding-muted)]">{block.description}</p> : null}
        {connected ? <div className="mt-4 flex items-center gap-3"><GoogleAdsLogo className="h-7 w-7" /><div className="min-w-0"><p className="break-words font-medium text-[var(--onboarding-text)]">{connection.accountName || "Google Ads account"}</p><p className="text-sm text-[var(--onboarding-muted)]">{formatGoogleAdsCustomerId(connection.customerId)}</p></div></div> : locked ? <p className="mt-4 text-sm text-[var(--onboarding-muted)]">This step has been submitted.</p> : !expanded ? <button type="button" onClick={() => setExpanded(true)} className={`${primaryButton} mt-4`}><GoogleAdsLogo />{block.label}</button> : <div className="mt-5 space-y-4">
            {loading ? <p className="text-sm text-[var(--onboarding-muted)]" role="status">Loading your connection…</p> : awaitingApproval ? <>
                <p className="text-sm leading-6 text-[var(--onboarding-text)]">Approve access for <strong>{manager.name}</strong>{manager.id ? <> ({formatGoogleAdsCustomerId(manager.id)})</> : null} to account <strong>{formatGoogleAdsCustomerId(connection.customerId)}</strong>.</p>
                <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-[var(--onboarding-muted)]">
                    <li>Open Google Ads and select this advertising account.</li>
                    <li>Go to <strong>Admin → Access and security → Managers</strong>.</li>
                    <li>Accept the request from {manager.name}. You must be an administrator of the advertising account. Complete any additional approval Google asks for.</li>
                    <li>Return here and check the connection.</li>
                </ol>
                <div className="flex flex-col flex-wrap gap-3 sm:flex-row">{preview ? <button type="button" disabled className={secondaryButton}>Open Google Ads</button> : <a href="https://ads.google.com/aw/accountaccess" target="_blank" rel="noopener noreferrer" className={secondaryButton}>Open Google Ads ↗</a>}<button type="button" disabled={pending} onClick={() => connect("verify")} className={primaryButton}>{pending ? "Checking…" : "Check connection"}</button></div>
                {!pending && !preview ? <button type="button" onClick={() => connect("request")} className="min-h-11 text-sm text-[var(--onboarding-primary)] underline underline-offset-4">No invitation showing? Retry access request</button> : null}
            </> : <form onSubmit={(event) => { event.preventDefault(); connect("request") }} className="space-y-4">
                <label className="block text-sm font-medium text-[var(--onboarding-text)]" htmlFor={`google-customer-${block.id}`}>Google Ads customer ID</label>
                <input id={`google-customer-${block.id}`} value={customerId} onChange={(event) => setCustomerId(event.target.value)} type="text" inputMode="numeric" autoComplete="off" maxLength={20} placeholder="123-456-7890" required disabled={pending} aria-describedby={`google-help-${block.id}`} className="block min-h-12 w-full rounded-xl border border-black/20 bg-[var(--onboarding-surface)] px-4 py-3 text-base text-[var(--onboarding-text)] outline-none focus:border-[var(--onboarding-primary)]" />
                <p id={`google-help-${block.id}`} className="text-xs leading-5 text-[var(--onboarding-muted)]">Find the 10-digit ID at the top of your Google Ads account. Choose the account that runs your ads.</p>
                <label className="flex items-start gap-3 text-sm leading-6 text-[var(--onboarding-text)]"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} required disabled={pending} className="mt-1 h-4 w-4 shrink-0 accent-[var(--onboarding-primary)]" /><span>I am authorised to connect this account to {manager.name} for campaign management and reporting.</span></label>
                <p className="text-sm leading-6 text-[var(--onboarding-muted)]">We’ll send a manager access request for you to approve in Google Ads. If the agency already has access, we’ll verify it now.</p>
                <button type="submit" disabled={pending || !consented || !manager.id && !preview} className={primaryButton}><GoogleAdsLogo />{pending ? "Connecting…" : "Send access request"}</button>
            </form>}
        </div>}
        {preview && expanded ? <p className="mt-3 text-xs text-[var(--onboarding-muted)]">Preview only. No Google account will be contacted.</p> : null}
        {notice ? <p role="status" className="mt-4 text-sm leading-6 text-[var(--onboarding-muted)]">{notice}</p> : null}
        {error ? <div role="alert" className="mt-4 text-sm leading-6 text-red-700"><p>{error} <RequestHelpLink />.</p>{!manager.id && !loading ? <button type="button" disabled={pending} onClick={() => { setError(null); setLoading(true); setReload((value) => value + 1) }} className="mt-2 min-h-11 underline">Retry loading connection</button> : null}</div> : null}
    </div>
}
