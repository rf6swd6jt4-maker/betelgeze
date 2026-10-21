"use client"

import { useEffect, useRef, useState } from "react"
import { CenteredDialog, Selector, Status } from "@/components/ui"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle } from "@/components/list/List"
import type { PortalMetaAdsReport } from "@/lib/client-portal/meta-ads-report"

type Account = { id: string; name: string; datasource: string }
type State = {
    connection: { revision: string; accountId: string | null; accountName: string | null; status: string; verifiedAt: string | null; lastReportAt: string | null; lastError: string | null; canReuseAuthorization: boolean } | null
    candidateId: string | null
    history: { id: string; previous_account_id: string | null; previous_account_name: string | null; account_id: string; account_name: string; created_at: string }[]
}

export function MetaReportingDialog({ workspaceSlug, relationshipId, clientName, onClose }: { workspaceSlug: string; relationshipId: string; clientName: string; onClose: () => void }) {
    const [state, setState] = useState<State | null>(null)
    const [pending, setPending] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [accounts, setAccounts] = useState<Account[]>([])
    const [accountId, setAccountId] = useState("")
    const [preview, setPreview] = useState<{ account: Account; report: PortalMetaAdsReport } | null>(null)
    const [confirmed, setConfirmed] = useState(false)
    const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null)
    const request = useRef<AbortController | null>(null)
    const endpoint = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/client-connections/meta-ads`

    async function read(signal: AbortSignal): Promise<State> {
        const response = await fetch(`${endpoint}?relationship=${encodeURIComponent(relationshipId)}`, { cache: "no-store", signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? "Reporting could not be loaded.")
        return body
    }

    useEffect(() => {
        const controller = new AbortController(); request.current = controller
        void read(AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]))
            .then(value => { if (!controller.signal.aborted) setState(value) })
            .catch(() => { if (!controller.signal.aborted) setError("Reporting could not be loaded. Close this dialog and try again.") })
            .finally(() => { if (!controller.signal.aborted) setPending(false) })
        return () => { controller.abort(); request.current?.abort() }
        // The dialog is keyed by relationship and workspace by its owner.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endpoint, relationshipId])

    async function run(action: "begin" | "accounts" | "preview" | "commit", reconnect = false) {
        if (!state || pending) return
        const child = action === "begin" && reconnect ? window.open("about:blank", "_blank", "popup=yes,width=680,height=780") : null
        if (child) child.opener = null
        request.current?.abort()
        const controller = new AbortController(); request.current = controller
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
        setPending(true); setError(null); setNotice(null)
        try {
            const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal,
                body: JSON.stringify({ action, relationshipId, candidateId: state.candidateId, expectedRevision: state.connection?.revision ?? null, accountId, confirmed, reconnect }) })
            const body = await response.json()
            if (!response.ok) throw new Error(body.error ?? "Reporting could not be updated.")
            if (controller.signal.aborted) return
            if (action === "begin") {
                setState({ ...state, candidateId: body.candidateId }); setAccounts([]); setAccountId(""); setPreview(null); setConfirmed(false); setAuthorizationUrl(body.authorizationUrl)
                if (body.authorizationUrl) { if (child) child.location.replace(body.authorizationUrl); setNotice("Finish the client authorization in Windsor, then load the authorized accounts here. The current reporting account remains active.") }
                else { child?.close(); setNotice("Authorization is ready. Load the authorized accounts to choose the client's reporting account.") }
            } else if (action === "accounts") {
                setAccounts(body.accounts); setAccountId(""); setPreview(null); setConfirmed(false)
                if (!body.accounts.length) setNotice("No Meta accounts are available yet. Finish the Windsor authorization or reconnect.")
            } else if (action === "preview") { setPreview(body); setConfirmed(false) }
            else {
                setState(await read(signal)); setPreview(null); setAccounts([]); setAccountId(""); setAuthorizationUrl(null); setConfirmed(false)
                setNotice("Reporting account saved. The completed onboarding record was preserved.")
            }
        } catch (cause) {
            child?.close()
            if (controller.signal.aborted) return
            if (action === "commit") {
                // Reconcile a lost acknowledgement before offering another save.
                try {
                    const latest = await read(AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]))
                    setState(latest)
                    if (latest.history.some(item => item.id === state.candidateId)) {
                        setPreview(null); setAccounts([]); setAccountId(""); setAuthorizationUrl(null); setConfirmed(false); setNotice("The reporting account was saved. The current selection is shown above."); return
                    }
                } catch { /* keep a clear unknown-outcome message */ }
                setError("The save could not be confirmed. Close and reopen this dialog to check the current account before trying again.")
            } else setError(cause instanceof Error ? cause.message : "Reporting could not be loaded.")
        } finally { if (!controller.signal.aborted) setPending(false) }
    }

    const connection = state?.connection
    return <CenteredDialog title="Meta Ads reporting" busy={pending} onClose={onClose}>
        <p className="text-sm text-neutral-300">{clientName}</p>
        {connection?.accountId ? <div className="mt-4 space-y-2">
            <Status label={connection.lastError ? "Report needs attention" : connection.verifiedAt ? "Reporting verified" : "Account verification needed"} tone={connection.lastError || !connection.verifiedAt ? "yellow" : "green"} />
            <p className="break-words font-medium">{connection.accountName ?? "Meta Ads account"}</p><p className="text-sm text-neutral-400">Account {connection.accountId}</p>
            <p className="text-xs text-neutral-400">{connection.lastReportAt ? `Last successful report: ${new Date(connection.lastReportAt).toLocaleString()}` : "No verified report has been retained yet."}</p>
        </div> : !pending ? <p className="mt-4 text-sm text-neutral-400">No reporting account has been selected.</p> : null}
        <div className="mt-5 space-y-3">
            <button type="button" disabled={pending || !state} onClick={() => void run("begin", !connection?.canReuseAuthorization)} className="min-h-11 rounded-lg border border-neutral-700 px-4 text-sm disabled:opacity-40">{connection?.canReuseAuthorization ? "Review authorized accounts" : "Connect in Windsor ↗"}</button>
            {connection?.canReuseAuthorization ? <button type="button" disabled={pending} onClick={() => void run("begin", true)} className="ml-2 min-h-11 px-3 text-sm underline disabled:opacity-40">Reconnect in Windsor ↗</button> : null}
            {authorizationUrl ? <p><a href={authorizationUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline">Continue authorization in Windsor ↗</a></p> : null}
            {state?.candidateId ? <button type="button" disabled={pending} onClick={() => void run("accounts")} className="block min-h-11 px-3 text-sm underline disabled:opacity-40">Load authorized accounts</button> : null}
            {accounts.length ? <label className="block text-sm text-neutral-300">Advertising account<Selector appearance="input" ariaLabel="Advertising account" value={accountId} onChange={value => { setAccountId(value); setPreview(null); setConfirmed(false) }} options={[{ value: "", label: "Choose the client's account" }, ...accounts.map(account => ({ value: account.id, label: `${account.name} · ${account.id}` }))]} /></label> : null}
            {accountId ? <button type="button" disabled={pending} onClick={() => void run("preview")} className="min-h-11 rounded-lg border border-neutral-700 px-4 text-sm disabled:opacity-40">Preview report</button> : null}
        </div>
        {preview ? <div className="mt-5 space-y-3 border-t border-neutral-800 pt-4">
            <p className="font-medium">{preview.account.name} · {preview.account.id}</p>
            <p className="text-sm text-neutral-400">{preview.report.dateFrom} – {preview.report.dateTo} · {preview.report.currency ?? "Currency unavailable for an empty report"}</p>
            <p className="text-sm">Spend {preview.report.totals.spend.toLocaleString()} · Impressions {preview.report.totals.impressions.toLocaleString()} · Clicks {preview.report.totals.clicks.toLocaleString()} · Leads {preview.report.totals.leads.toLocaleString()}</p>
            <p className="text-xs leading-5 text-neutral-400">A valid report can contain no activity. Check the account ID and the same dates in Ads Manager. Dates are requested explicitly; the provider’s account timezone is not supplied by this report.</p>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />This is the intended advertising account for {clientName}.</label>
            <button type="button" disabled={!confirmed || pending} onClick={() => void run("commit")} className="min-h-11 w-full rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">{pending ? "Saving…" : "Save reporting account"}</button>
        </div> : null}
        {pending ? <p role="status" className="mt-4 text-sm text-neutral-400">Checking reporting…</p> : null}
        {notice ? <p role="status" className="mt-4 text-sm leading-6 text-neutral-300">{notice}</p> : null}
        {error ? <p role="alert" className="mt-4 text-sm leading-6 text-red-300">{error}</p> : null}
        {state?.history.length ? <details className="mt-5 border-t border-neutral-800 pt-3 text-sm"><summary className="cursor-pointer py-2 text-neutral-400">Recent account changes</summary><List ariaLabel="Recent reporting account changes">{state.history.map(item => <ListItem key={item.id}><ListPrimaryRow><ListTitle>{item.account_name} · {item.account_id}</ListTitle></ListPrimaryRow><ListSecondaryRow>{new Date(item.created_at).toLocaleString()}{item.previous_account_id ? ` · Previously ${item.previous_account_name ?? item.previous_account_id}` : ""}</ListSecondaryRow></ListItem>)}</List></details> : null}
    </CenteredDialog>
}
