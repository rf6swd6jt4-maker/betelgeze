"use client"
import { useEffect, useRef, useState } from "react"
import { SelectorDrawer, SelectorOption, SelectorTrigger, RoundPill } from "@/components/ui"
import { DetailField, DetailFields } from "@/components/detail"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { sopButtonClass, sopCommand } from "./client"
type Choice = { id: string; name: string }
type Link = { service_id: string; service_name: string; asset_id: string; asset_name: string }
type Page<T> = { items: T[]; hasMore: boolean }
async function read<T>(url: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), cache: "no-store", credentials: "same-origin", redirect: "error" })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? "Could not load choices.")
    return data
}
function Pages({ page, more, change }: { page: number; more: boolean; change: (page: number) => void }) {
    return page || more ? <div className="flex items-center justify-between gap-3 text-sm"><button type="button" className="min-h-11 px-2 disabled:opacity-40" disabled={!page} onClick={() => change(page - 1)}>Previous</button><span>Page {page + 1}</span><button type="button" className="min-h-11 px-2 disabled:opacity-40" disabled={!more} onClick={() => change(page + 1)}>Next</button></div> : null
}
function ChoicePicker({ endpoint, kind, label, value, onChange, disabled }: { endpoint: string; kind: "catalogue" | "sources"; label: string; value: Choice | null; onChange: (value: Choice) => void; disabled: boolean }) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null), [page, setPage] = useState(0), [query, setQuery] = useState("")
    const [data, setData] = useState<Page<Choice> | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0)
    useEffect(() => {
        if (!anchor) return
        const controller = new AbortController()
        const timer = setTimeout(() => { void read<Page<Choice>>(`${endpoint}?kind=${kind}&offset=${page * 30}&q=${encodeURIComponent(query)}`, controller.signal).then(value => { if (!controller.signal.aborted) { setData(value); setError("") } }).catch(error => { if (!controller.signal.aborted) setError(error.message) }) }, query ? 200 : 0)
        return () => { clearTimeout(timer); controller.abort() }
    }, [anchor, endpoint, kind, page, query, retry])
    return <><SelectorTrigger disabled={disabled} open={Boolean(anchor)} aria-label={label} onClick={event => setAnchor(event.currentTarget)}>{value?.name ?? `Choose ${kind === "catalogue" ? "service" : "main SOP file"}`}</SelectorTrigger>
        <SelectorDrawer anchor={anchor} ariaLabel={label} title={label} onDismiss={() => setAnchor(null)} search={kind === "catalogue" ? query : undefined} onSearch={kind === "catalogue" ? value => { setQuery(value); setPage(0); setData(null) } : undefined} footer={data ? <Pages page={page} more={data.hasMore} change={value => { setPage(value); setData(null) }} /> : undefined}>
            {error ? <p role="alert" className="p-3 text-sm text-red-300">{error} <button type="button" className="min-h-11 underline" onClick={() => setRetry(n => n + 1)}>Retry</button></p> : !data ? <p className="p-3 text-sm text-neutral-400">Loading choices…</p> : data.items.length ? data.items.map(item => <SelectorOption key={item.id} selected={item.id === value?.id} onClick={() => { onChange(item); setAnchor(null) }}>{item.name}</SelectorOption>) : <p className="p-3 text-sm text-neutral-400">{kind === "sources" ? "Upload a readable file below and mark it Main procedure." : "No published services found."}</p>}
        </SelectorDrawer></>
}
export function SopServiceLinks({ workspaceSlug, sopId, userId, canEdit }: { workspaceSlug: string; sopId: string; userId: string; canEdit: boolean }) {
    const endpoint = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/sops/${sopId}/services`
    const active = useWorkspaceNavigation()?.active ?? true
    const [data, setData] = useState<Page<Link> | null>(null), [page, setPage] = useState(0), [retry, setRetry] = useState(0)
    const [service, setService] = useState<Choice | null>(null), [asset, setAsset] = useState<Choice | null>(null)
    const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("")
    const saving = useRef(false)
    useEffect(() => {
        if (!active) return
        const controller = new AbortController()
        void read<Page<Link>>(`${endpoint}?offset=${page * 30}`, controller.signal).then(value => { if (!controller.signal.aborted) { setData(value); setError("") } }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
        return () => controller.abort()
    }, [endpoint, page, retry, active])
    async function save(link: { serviceId: string; assetId: string; unlink: boolean }) {
        if (saving.current) return
        saving.current = true; setBusy(true); setError("")
        try { await sopCommand(endpoint, { ...link, userId }); setEditing(false); setService(null); setAsset(null); setRetry(n => n + 1) }
        catch (error) { setError(error instanceof Error ? error.message : "The link could not be saved.") }
        finally { saving.current = false; setBusy(false) }
    }
    return <section className="mt-6" aria-label="SOP service links"><h2 className="text-base font-medium">Linked services</h2><p className="mt-1 text-sm leading-6 text-neutral-500">Choose which catalogue services use this SOP. When a linked service begins Setup, its work follows the selected main procedure.</p>
        {!data && !error ? <p className="py-3 text-sm text-neutral-400">Loading linked services…</p> : data?.items.length ? <div className="mt-3 divide-y divide-neutral-900">{data.items.map(link => <div key={link.service_id} className="flex min-w-0 flex-wrap items-center gap-3 py-2"><div className="min-w-0 flex-1"><RoundPill tone="emerald">{link.service_name}</RoundPill><p className="mt-1 break-words text-xs text-neutral-500">{link.asset_name}</p></div>{canEdit ? <button type="button" className="min-h-11 px-2 text-sm text-neutral-400 underline" disabled={busy} onClick={() => void save({ serviceId: link.service_id, assetId: link.asset_id, unlink: true })}>Unlink</button> : null}</div>)}</div> : <p className="py-3 text-sm text-neutral-400">No services linked.</p>}
        {data ? <Pages page={page} more={data.hasMore} change={setPage} /> : null}
        {canEdit && !editing ? <button type="button" className="min-h-11 text-sm text-neutral-300 underline" disabled={busy} onClick={() => setEditing(true)}>Link service</button> : null}
        {canEdit && editing ? <form className="max-w-xl" onSubmit={event => { event.preventDefault(); if (service && asset) void save({ serviceId: service.id, assetId: asset.id, unlink: false }) }}><DetailFields columns={1}><DetailField label="Service" icon="status"><ChoicePicker endpoint={endpoint} kind="catalogue" label="Service from catalogue" value={service} onChange={setService} disabled={busy} /></DetailField><DetailField label="SOP file" icon="description"><ChoicePicker endpoint={endpoint} kind="sources" label="Main SOP file" value={asset} onChange={setAsset} disabled={busy} /></DetailField></DetailFields><div className="mt-3 flex gap-3"><button className={sopButtonClass} disabled={busy || !service || !asset}>{busy ? "Saving…" : "Link service"}</button><button type="button" className="min-h-11 px-2 text-sm text-neutral-400" disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div></form> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error} <button type="button" className="min-h-11 underline" onClick={() => setRetry(n => n + 1)}>Refresh links</button></p> : null}
    </section>
}
