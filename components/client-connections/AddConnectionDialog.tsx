"use client"
/* eslint-disable @next/next/no-img-element -- Small local provider brand thumbnails. */

import { useEffect, useRef, useState, type FormEvent } from "react"
import { CenteredDialog, ChoiceCard, ChoiceCards, Selector } from "@/components/ui"
import { GoogleAdsLogo } from "@/components/brand/GoogleAdsLogo"
import type { ClientConnectionAccount } from "@/lib/client-connections"

export type ConnectionProvider = "ghl" | "meta_ads" | "google_ads"
const names = { ghl: "GHL", meta_ads: "Meta Ads", google_ads: "Google Ads" }
const clientLabel = (account: ClientConnectionAccount) => account.businessName ? `${account.clientName} – ${account.businessName}` : account.clientName

export function AddConnectionDialog({ workspaceSlug, onClose, onChoose }: { workspaceSlug: string; onClose: () => void; onChoose: (provider: ConnectionProvider, account: ClientConnectionAccount) => void }) {
    const [provider, setProvider] = useState<ConnectionProvider | null>(null)
    const [accounts, setAccounts] = useState<ClientConnectionAccount[]>([])
    const [selected, setSelected] = useState("")
    const [query, setQuery] = useState("")
    const [cursor, setCursor] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const request = useRef<AbortController | null>(null)
    const lastQuery = useRef({ query: "", after: undefined as string | undefined })
    useEffect(() => () => { request.current?.abort(); request.current = null }, [])
    async function load(nextProvider: ConnectionProvider, search = "", after?: string) {
        request.current?.abort()
        const controller = new AbortController(); request.current = controller
        lastQuery.current = { query: search, after }
        const timeout = setTimeout(() => controller.abort(), 30_000)
        setLoading(true); setError(null)
        if (!after) { setAccounts([]); setSelected(""); setCursor(null) }
        try {
            const params = new URLSearchParams({ provider: nextProvider })
            if (search) params.set("query", search)
            if (after) params.set("after", after)
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/client-connections/relationships?${params}`, { cache: "no-store", signal: controller.signal })
            const result = await response.json()
            if (request.current !== controller || controller.signal.aborted) return
            if (response.status === 401 || response.status === 403) { setAccounts([]); setSelected(""); setCursor(null) }
            if (!response.ok || !Array.isArray(result.accounts)) throw new Error(result.error || "Relationships could not be loaded. Try again.")
            setAccounts(current => [...new Map([...(after ? current : []), ...result.accounts].filter(account => !account.archived && !account.historyId).map(account => [account.relationshipId, account])).values()])
            setCursor(result.nextCursor)
        } catch (cause) {
            if (request.current === controller) setError(controller.signal.aborted ? "Relationships took too long to load. Try again." : cause instanceof Error ? cause.message : "Relationships could not be loaded.")
        } finally { clearTimeout(timeout); if (request.current === controller) { request.current = null; setLoading(false) } }
    }
    function chooseProvider(value: ConnectionProvider) { setProvider(value); setQuery(""); void load(value) }
    function back() { request.current?.abort(); request.current = null; setProvider(null); setAccounts([]); setSelected(""); setCursor(null); setLoading(false); setError(null) }
    function search(event: FormEvent) { event.preventDefault(); if (provider) void load(provider, query.trim()) }
    const account = accounts.find(row => row.relationshipId === selected)
    return <CenteredDialog title={provider ? `Add ${names[provider]} connection` : "Add connection"} wide={!provider} onClose={onClose}>
        {!provider ? <><p className="mb-4 text-sm text-neutral-400">Choose a provider, then the active relationship to connect.</p><ChoiceCards label="Connection providers">
            <ChoiceCard label="GHL" description="Calendars and CRM" thumbnail={<img src="/connection-providers/highlevel.svg" alt="" className="w-24 sm:w-32" />} onClick={() => chooseProvider("ghl")} />
            <ChoiceCard label="Meta Ads" description="Advertising reports" thumbnail={<img src="/service-templates/meta-ads.png" alt="" className="h-full w-full object-contain" />} onClick={() => chooseProvider("meta_ads")} />
            <ChoiceCard label="Google Ads" description="Advertising account" thumbnail={<GoogleAdsLogo className="h-12 w-12 sm:h-16 sm:w-16" />} onClick={() => chooseProvider("google_ads")} />
        </ChoiceCards></> : <>
            <button type="button" onClick={back} className="mb-3 min-h-11 text-sm text-neutral-300 underline underline-offset-4">Back to providers</button>
            <p className="mb-4 text-sm text-neutral-400">Choose an active relationship you can manage.</p>
            <form onSubmit={search} className="mb-4 flex items-end gap-2"><label className="min-w-0 flex-1 text-sm">Find relationship<input value={query} onChange={event => setQuery(event.target.value)} maxLength={100} placeholder="Name or business" className="mt-2 h-11 w-full rounded-xl border border-neutral-700 bg-black px-3 text-sm text-white" /></label><button type="submit" disabled={loading} className="h-11 rounded-lg border border-neutral-700 px-3 text-sm disabled:opacity-40">Search</button></form>
            <Selector appearance="input" value={selected} onChange={setSelected} ariaLabel="Active relationship" placeholder="Choose relationship" disabled={loading && !accounts.length} options={accounts.map(row => ({ value: row.relationshipId, label: clientLabel(row), description: provider === "ghl" && row.connected ? "GHL already connected" : undefined }))} />
            {loading ? <p role="status" className="mt-3 text-sm text-neutral-400">Loading relationships…</p> : !error && !accounts.length ? <p role="status" className="mt-3 text-sm text-neutral-400">No matching active relationships are available.</p> : null}
            {error ? <div className="mt-3"><p role="alert" className="text-sm text-red-200">{error}</p><button type="button" disabled={loading} onClick={() => void load(provider, lastQuery.current.query, lastQuery.current.after)} className="min-h-11 text-sm underline underline-offset-4">Retry relationships</button></div> : null}
            {cursor && !error ? <button type="button" disabled={loading} onClick={() => void load(provider, lastQuery.current.query, cursor)} className="mt-2 min-h-11 text-sm underline underline-offset-4 disabled:opacity-40">Load more relationships</button> : null}
            <button type="button" disabled={!account || loading} onClick={() => { if (account) onChoose(provider, account) }} className="mt-5 min-h-11 w-full rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">{provider === "ghl" && account?.connected ? "Manage connection" : "Continue"}</button>
        </>}
    </CenteredDialog>
}
