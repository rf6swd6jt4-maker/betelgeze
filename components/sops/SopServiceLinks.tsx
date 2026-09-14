"use client"
import { useEffect, useRef, useState } from "react"
import { SelectorDrawer, SelectorOption, RoundPill, PillField } from "@/components/ui"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { sopCommand } from "./client"
type Choice = { id: string; name: string }
type Link = { service_id: string; service_name: string }
type Page<T> = { items: T[]; hasMore: boolean }
async function read<T>(url: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), cache: "no-store", credentials: "same-origin", redirect: "error" })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? "Could not load services.")
    return data
}
export function SopServiceLinks({ workspaceSlug, sopId, userId, canEdit }: { workspaceSlug: string; sopId: string; userId: string; canEdit: boolean }) {
    const endpoint = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/sops/${sopId}/services`
    const active = useWorkspaceNavigation()?.active ?? true
    const [links, setLinks] = useState<Page<Link> | null>(null), [linkPage, setLinkPage] = useState(0), [revision, setRevision] = useState(0)
    const [anchor, setAnchor] = useState<HTMLElement | null>(null), [choices, setChoices] = useState<Page<Choice> | null>(null)
    const [page, setPage] = useState(0), [query, setQuery] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("")
    const saving = useRef(false)
    useEffect(() => {
        if (!active) return
        const controller = new AbortController()
        void read<Page<Link>>(`${endpoint}?offset=${linkPage * 30}`, controller.signal).then(data => { if (!controller.signal.aborted) setLinks(data) }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
        return () => controller.abort()
    }, [active, endpoint, linkPage, revision])
    useEffect(() => {
        if (!anchor || !active) return
        const controller = new AbortController()
        const timer = setTimeout(() => { void read<Page<Choice>>(`${endpoint}?kind=catalogue&offset=${page * 30}&q=${encodeURIComponent(query)}`, controller.signal).then(data => { if (!controller.signal.aborted) setChoices(data) }).catch(e => { if (!controller.signal.aborted) setError(e.message) }) }, query ? 200 : 0)
        return () => { clearTimeout(timer); controller.abort() }
    }, [anchor, active, endpoint, page, query, revision])
    async function save(serviceId: string, unlink: boolean) {
        if (saving.current) return
        saving.current = true; setBusy(true); setError("")
        try { await sopCommand(endpoint, { serviceId, unlink, userId }); setAnchor(null); setRevision(n => n + 1) }
        catch (e) { setError(e instanceof Error ? e.message : "Could not save services.") }
        finally { saving.current = false; setBusy(false) }
    }
    return <div className="min-w-0">
        <PillField empty={links ? "None" : "Loading…"} addLabel="Add service to SOP" disabled={busy || !links} open={Boolean(anchor)} onAdd={canEdit ? element => { setAnchor(element); setQuery(""); setPage(0); setChoices(null); setError("") } : undefined}>
            {links?.items.length ? links.items.map(link => <RoundPill key={link.service_id} tone="emerald"><span className="inline-flex max-w-full items-center gap-1.5"><span className="truncate">{link.service_name}</span>{canEdit ? <button type="button" data-icon-button disabled={busy} aria-label={`Remove ${link.service_name} from SOP`} onClick={() => void save(link.service_id, true)} className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-40">×</button> : null}</span></RoundPill>) : null}
        </PillField>
        {links && (linkPage > 0 || links.hasMore) ? <div className="flex gap-3 text-xs text-neutral-400"><button disabled={!linkPage || busy} onClick={() => setLinkPage(n => n - 1)}>Previous</button><button disabled={!links.hasMore || busy} onClick={() => setLinkPage(n => n + 1)}>More services</button></div> : null}
        <SelectorDrawer anchor={anchor} title="Services" ariaLabel="Services from catalogue" search={query} onSearch={value => { setQuery(value); setPage(0); setChoices(null) }} onDismiss={() => { if (!busy) setAnchor(null) }} footer={choices && (page || choices.hasMore) ? <div className="flex justify-between text-sm"><button disabled={!page || busy} onClick={() => { setPage(n => n - 1); setChoices(null) }}>Previous</button><button disabled={!choices.hasMore || busy} onClick={() => { setPage(n => n + 1); setChoices(null) }}>Next</button></div> : undefined}>
            {!choices ? <p className="p-3 text-sm text-neutral-400">Loading services…</p> : choices.items.map(item => <SelectorOption key={item.id} disabled={busy || links?.items.some(link => link.service_id === item.id)} selected={links?.items.some(link => link.service_id === item.id)} onClick={() => void save(item.id, false)}><RoundPill tone="emerald">{item.name}</RoundPill></SelectorOption>)}
            {choices && !choices.items.length ? <p className="p-3 text-sm text-neutral-400">No services found.</p> : null}
            {busy ? <p role="status" className="p-2 text-xs text-neutral-500">Saving…</p> : null}
            {error ? <p role="alert" className="p-2 text-sm text-red-300">{error}</p> : null}
        </SelectorDrawer>
        {error && !anchor ? <p role="alert" className="mt-2 text-sm text-red-300">{error} <button className="underline" onClick={() => { setError(""); setRevision(n => n + 1) }}>Retry</button></p> : null}
    </div>
}
