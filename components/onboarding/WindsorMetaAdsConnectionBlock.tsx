"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { getWindsorMetaAdsOnboarding, verifyWindsorMetaAdsOnboarding } from "@/app/onboarding/session/[token]/windsor-meta-ads-actions"
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

const primaryButton = "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--onboarding-primary)] px-5 py-3 text-center font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
const secondaryButton = "inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-[var(--onboarding-primary)] px-5 py-3 text-center font-medium text-[var(--onboarding-primary)] disabled:opacity-50 sm:w-auto"

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
    const [expanded, setExpanded] = useState(Boolean(initial))
    const [loading, setLoading] = useState(!preview && !locked)
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const callbacks = useRef({ onSatisfied, onUnsatisfied })
    useEffect(() => { callbacks.current = { onSatisfied, onUnsatisfied } }, [onSatisfied, onUnsatisfied])

    useEffect(() => {
        if (preview || locked || !sessionBlockId) return
        let cancelled = false
        startTransition(async () => {
            try {
                const outcome = await getWindsorMetaAdsOnboarding(token, sessionBlockId)
                if (cancelled) return
                if (!outcome.ok) { setError(outcome.error); return }
                setConnection(outcome.connection)
                if (outcome.connection) setExpanded(true)
                if (outcome.satisfied) callbacks.current.onSatisfied()
                else callbacks.current.onUnsatisfied()
            } catch { if (!cancelled) setError("Your Meta Ads connection could not be loaded. Check your internet connection and try again.") }
            finally { if (!cancelled) setLoading(false) }
        })
        return () => { cancelled = true }
    }, [token, sessionBlockId, preview, locked])

    function check(accountId?: string) {
        if (pending || loading || locked) return
        setError(null)
        setNotice(null)
        startTransition(async () => {
            if (preview) {
                setConnection({ status: "connected", accountId: "act_123456789", accountName: "Example Meta Ads account", datasource: "facebook_ads", connectedAt: new Date().toISOString() })
                callbacks.current.onSatisfied()
                return
            }
            if (!sessionBlockId) { setError("This connection block is unavailable. Refresh your onboarding page."); return }
            const outcome = await verifyWindsorMetaAdsOnboarding(token, sessionBlockId, accountId || null)
            if (!outcome.ok) { callbacks.current.onUnsatisfied(); setError(outcome.error); return }
            setConnection(outcome.connection)
            setAccounts(outcome.accounts)
            if (outcome.satisfied) { callbacks.current.onSatisfied(); setSelectedAccount("") }
            else {
                callbacks.current.onUnsatisfied()
                setNotice(outcome.accounts.length > 1 ? "Choose the advertising account for this relationship." : "No advertising account is visible yet. In Windsor.ai, finish Facebook authorization, select the account, and press Finish. Then check again.")
            }
        })
    }

    const connected = satisfied && connection?.status === "connected"
    const startHref = preview || !sessionBlockId ? undefined : `/api/onboarding/session/${encodeURIComponent(token)}/windsor-meta-ads/start?block=${encodeURIComponent(sessionBlockId)}`
    return <div className="rounded-2xl border border-black/10 bg-[var(--onboarding-page)] p-4 text-left sm:p-5" aria-busy={loading || pending}>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-semibold text-[var(--onboarding-text)]">Meta Ads reporting</p>{connected ? <Status label="Connected" tone="green" surface="light" /> : connection ? <Status label="Connection started" tone="yellow" surface="light" /> : null}</div>
        <p className="mt-2 text-sm leading-6 text-[var(--onboarding-muted)]">{block.description || "Connect the Meta Ads account that runs your campaigns so your results can appear in the client portal."}</p>
        {connected ? <div className="mt-4 flex items-center gap-3"><span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-lg font-bold text-white">f</span><div className="min-w-0"><p className="break-words font-medium text-[var(--onboarding-text)]">{connection.accountName || "Meta Ads account"}</p><p className="break-all text-sm text-[var(--onboarding-muted)]">{connection.accountId?.replace(/^act_/, "")}</p></div></div>
        : locked ? <p className="mt-4 text-sm text-[var(--onboarding-muted)]">This step has been submitted.</p>
        : !expanded ? <button type="button" onClick={() => setExpanded(true)} className={`${primaryButton} mt-4`}><span aria-hidden="true" className="font-bold">f</span>{block.label}</button>
        : <div className="mt-5 space-y-4">
            {loading ? <p role="status" className="text-sm text-[var(--onboarding-muted)]">Loading your connection…</p> : <>
                <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-[var(--onboarding-muted)]">
                    <li>Open the secure connection and sign in with the Facebook user that can view the advertising account.</li>
                    <li>Approve access, select the account that runs your ads, and press <strong>Finish</strong> in Windsor.ai.</li>
                    <li>Return here and check the connection.</li>
                </ol>
                <div className="flex flex-col flex-wrap gap-3 sm:flex-row">{preview ? <button type="button" disabled className={secondaryButton}>Open secure connection</button> : <a href={startHref} target="_blank" rel="noopener noreferrer" onClick={() => { setConnection((current) => current ?? { status: "pending", accountId: null, accountName: null, datasource: null, connectedAt: null }); setNotice("Finish the connection in the new tab, then return here.") }} className={secondaryButton}>Open secure connection ↗</a>}<button type="button" disabled={pending} onClick={() => check()} className={primaryButton}>{pending ? "Checking…" : "Check connection"}</button></div>
                {accounts.length > 1 ? <div className="rounded-xl border border-black/10 bg-[var(--onboarding-surface)] p-4"><label htmlFor={`windsor-account-${block.id}`} className="block text-sm font-medium text-[var(--onboarding-text)]">Advertising account</label><select id={`windsor-account-${block.id}`} value={selectedAccount} onChange={(event) => setSelectedAccount(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-black/20 bg-[var(--onboarding-surface)] px-4 text-base text-[var(--onboarding-text)]"><option value="">Choose an account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.id.replace(/^act_/, "")}</option>)}</select><button type="button" disabled={pending || !selectedAccount} onClick={() => check(selectedAccount)} className={`${primaryButton} mt-3`}>Use this account</button></div> : null}
            </>}
        </div>}
        {preview && expanded ? <p className="mt-3 text-xs text-[var(--onboarding-muted)]">Preview only. No account will be contacted.</p> : null}
        {notice ? <p role="status" className="mt-4 text-sm leading-6 text-[var(--onboarding-muted)]">{notice}</p> : null}
        {error ? <p role="alert" className="mt-4 text-sm leading-6 text-red-700">{error} <RequestHelpLink />.</p> : null}
    </div>
}
