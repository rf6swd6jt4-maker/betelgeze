"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { DetailField, DetailFields } from "@/components/detail"
import { ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { CenteredDialog, Status } from "@/components/ui"
import type { AdvertisingConnectionCursor, AdvertisingConnectionsPage, ClientAdvertisingConnection } from "@/lib/client-advertising-connections"

const providerNames = { google_ads: "Google Ads", meta_ads: "Meta Ads access", windsor: "Meta Ads reporting · Windsor" }
const states = {
    connected: { label: "Connected", tone: "green" as const },
    pending: { label: "Pending", tone: "yellow" as const },
    needs_attention: { label: "Needs attention", tone: "yellow" as const },
    revoked: { label: "Revoked", tone: "red" as const },
}
const key = (account: ClientAdvertisingConnection) => `${account.relationshipId}:${account.provider}`

// Mounted separately from HighLevel so provider-summary reads cannot hold up
// its existing list, editor or mutations. No provider calls or background poll.
export function AdvertisingConnectionRows({ workspaceSlug, relationshipId, refresh, onManageWindsor }: { workspaceSlug: string; relationshipId?: string; refresh: { relationshipId: string } | null; onManageWindsor: (account: ClientAdvertisingConnection) => void }) {
    const [accounts, setAccounts] = useState<ClientAdvertisingConnection[]>([])
    const [cursor, setCursor] = useState<AdvertisingConnectionCursor | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [selectedKey, setSelectedKey] = useState<string | null>(null)
    const request = useRef<AbortController | null>(null)
    const lastRefresh = useRef(refresh)
    const initialized = useRef(false)
    const retry = useRef<{ after?: AdvertisingConnectionCursor; relationshipId?: string }>({})
    const selected = accounts.find(account => key(account) === selectedKey)

    const load = useCallback((after?: AdvertisingConnectionCursor, refreshRelationship?: string) => {
        retry.current = { after, relationshipId: refreshRelationship }
        request.current?.abort()
        const controller = new AbortController(); request.current = controller
        const timeout = setTimeout(() => controller.abort(), 30_000)
        const query = new URLSearchParams()
        if (refreshRelationship || relationshipId) query.set("relationship", refreshRelationship || relationshipId!)
        if (after) { query.set("after", after.relationshipId); query.set("provider", after.provider) }
        return fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/client-connections/advertising?${query}`, { cache: "no-store", signal: controller.signal })
            .then(async response => {
                if (request.current !== controller || controller.signal.aborted) return
                if (response.status === 401 || response.status === 403) { setAccounts([]); setCursor(null); setSelectedKey(null) }
                const result = await response.json() as AdvertisingConnectionsPage & { error?: string }
                if (request.current !== controller || controller.signal.aborted) return
                if (!response.ok || !Array.isArray(result.accounts)) throw new Error(result.error || "Advertising connections could not be loaded. Try again.")
                setError(null)
                setAccounts(current => {
                    const retained = refreshRelationship ? current.filter(row => row.relationshipId !== refreshRelationship) : after ? current : []
                    return [...new Map([...retained, ...result.accounts].map(row => [key(row), row])).values()]
                })
                if (!refreshRelationship) { setCursor(result.nextCursor); initialized.current = true }
            }).catch(cause => {
                if (request.current === controller) setError(controller.signal.aborted ? "Advertising connections took too long to load. Try again." : cause instanceof Error ? cause.message : "Advertising connections could not be loaded.")
            }).finally(() => {
                clearTimeout(timeout)
                if (request.current === controller) { request.current = null; setLoading(false) }
            })
    }, [workspaceSlug, relationshipId])
    function reload(after?: AdvertisingConnectionCursor, refreshRelationship?: string) {
        setLoading(true); setError(null); void load(after, refreshRelationship)
    }
    useEffect(() => {
        void load()
        return () => { request.current?.abort(); request.current = null }
    }, [load])
    useEffect(() => {
        if (refresh === lastRefresh.current) return
        lastRefresh.current = refresh
        if (refresh && (!relationshipId || refresh.relationshipId === relationshipId)) void load(undefined, initialized.current ? refresh.relationshipId : undefined)
    }, [refresh, load, relationshipId])

    return <>
        {accounts.map(account => {
            const title = account.businessName ? `${account.clientName} – ${account.businessName}` : account.clientName
            const provider = providerNames[account.provider], status = states[account.status]
            return <ListItem key={key(account)}>
                <ListPrimaryRow><ListTitle className="flex-1">{title}</ListTitle><Status {...status} /></ListPrimaryRow>
                <ListSecondaryRow><span className="min-w-0 truncate text-neutral-400">{provider}{account.accountName ? ` · ${account.accountName}` : ""}{account.archived ? " · Archived relationship" : ""}</span><ListTrailing>
                    <button type="button" aria-label={`${provider} details for ${title}`} onClick={() => account.provider === "windsor" && !account.archived ? onManageWindsor(account) : setSelectedKey(key(account))} className="-my-3 flex h-11 w-11 shrink-0 items-center justify-center text-neutral-300 hover:text-white"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><circle cx="4" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="16" cy="10" r="1.5" /></svg></button>
                </ListTrailing></ListSecondaryRow>
            </ListItem>
        })}
        {loading ? <p role="status" className="px-4 py-3 text-sm text-neutral-400">Loading advertising connections…</p> : null}
        {error ? <div className="px-4 py-3"><p role="alert" className="text-sm text-red-200">{error}</p><button type="button" disabled={loading} onClick={() => reload(retry.current.after, retry.current.relationshipId)} className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-40">Retry advertising connections</button></div> : null}
        {cursor && !error ? <button type="button" disabled={loading} onClick={() => reload(cursor)} className="min-h-11 px-4 text-sm underline underline-offset-4 disabled:opacity-40">Load more advertising connections</button> : null}
        {selected ? <CenteredDialog title={providerNames[selected.provider]} onClose={() => setSelectedKey(null)}>
            <DetailFields columns={1}>
                <DetailField label="Client" icon="relationship">{selected.businessName || selected.clientName}</DetailField>
                <DetailField label="Status" icon="status"><Status {...states[selected.status]} /></DetailField>
                {selected.accountName ? <DetailField label="Account" icon="company">{selected.accountName}</DetailField> : null}
                {selected.accountId ? <DetailField label="Account ID" icon="identity"><span className="break-all">{selected.accountId}</span></DetailField> : null}
                {selected.connectedAt ? <DetailField label="Connected" icon="time">{new Date(selected.connectedAt).toLocaleString()}</DetailField> : null}
                {selected.verifiedAt ? <DetailField label="Last verified" icon="time">{new Date(selected.verifiedAt).toLocaleString()}</DetailField> : null}
            </DetailFields>
            <p className="mt-4 text-sm leading-6 text-neutral-400">{selected.status === "pending" ? "Authorization has started. Finish the connection in client onboarding and return there to confirm it." : "This is the saved authorization status. It does not confirm that a report can be loaded now."}</p>
            <button type="button" disabled={loading} onClick={() => reload(undefined, selected.relationshipId)} className="mt-3 min-h-11 text-sm underline underline-offset-4 disabled:opacity-40">{loading ? "Refreshing…" : "Refresh saved status"}</button>
            {error ? <p role="alert" className="mt-2 text-sm text-red-200">{error}</p> : null}
        </CenteredDialog> : null}
    </>
}
