"use client"

import { useCallback, useState, type FormEvent } from "react"
import { ClientPortalProgressTimeline } from "@/components/client-portal/ClientPortalProgressTimeline"
import { CenteredDialog, Status } from "@/components/ui"
import { clientPortalOverview, progressLabels, type ClientPortalOverview, type PortalProgressStatus } from "@/lib/client-portal/overview"

const statusOptions: PortalProgressStatus[] = ["preparing", "in_progress", "in_review", "live", "complete"]

function ActionsIcon() {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M9 5h10M9 12h10M9 19h10" /><path d="m4 5 .8.8L6.5 4M4 12l.8.8L6.5 11M4 19l.8.8 1.7-1.8" /></svg>
}

async function portalRequest(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } })
    const payload = await response.json().catch(() => null) as unknown
    if (!response.ok) {
        const error = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "The client portal actions could not be updated."
        throw new Error(error)
    }
    return clientPortalOverview(payload)
}

export function ClientPortalActions({ workspaceSlug, relationshipId }: { workspaceSlug: string; relationshipId: string }) {
    const [open, setOpen] = useState(false)
    const [overview, setOverview] = useState<ClientPortalOverview | null>(null)
    const [loading, setLoading] = useState(false)
    const [pending, setPending] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [title, setTitle] = useState("")
    const [editingProgress, setEditingProgress] = useState<string | null>(null)
    const endpoint = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/relationships/${encodeURIComponent(relationshipId)}/portal`
    const load = useCallback(async () => {
        setLoading(true); setError(null)
        try { setOverview(await portalRequest(endpoint)) }
        catch (reason) { setError(reason instanceof Error ? reason.message : "The client portal actions could not be loaded.") }
        finally { setLoading(false) }
    }, [endpoint])
    const toggle = () => {
        if (open) { setOpen(false); setEditingProgress(null); return }
        setOpen(true); void load()
    }
    const update = async (input: { kind: "action" | "progress"; id: string; status: string; updatedAt: string }) => {
        setPending(input.id); setError(null)
        try { setOverview(await portalRequest(endpoint, { method: "PATCH", body: JSON.stringify(input) })); setEditingProgress(null) }
        catch (reason) { setError(reason instanceof Error ? reason.message : "The client portal action could not be updated.") }
        finally { setPending(null) }
    }
    const add = async (event: FormEvent) => {
        event.preventDefault()
        const next = title.trim()
        if (!next) return
        setPending("new"); setError(null)
        try { setOverview(await portalRequest(endpoint, { method: "POST", body: JSON.stringify({ title: next }) })); setTitle("") }
        catch (reason) { setError(reason instanceof Error ? reason.message : "The client portal action could not be added.") }
        finally { setPending(null) }
    }
    const actions = overview ? [...overview.actions.filter((item) => item.status === "open"), ...overview.actions.filter((item) => item.status === "completed")] : []
    const openCount = overview?.actions.filter((item) => item.status === "open").length ?? 0
    const progress = overview?.progress.find((item) => item.id === editingProgress) ?? null
    const addAction = !progress ? <form onSubmit={add} className="flex min-w-0 gap-2"><label className="sr-only" htmlFor={`portal-action-${relationshipId}`}>New required action</label><input id={`portal-action-${relationshipId}`} value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} placeholder="Add required action" className="h-10 min-w-0 flex-1 rounded-lg border border-neutral-700 bg-black px-3 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-500" /><button type="submit" disabled={!title.trim() || pending === "new"} className="h-10 shrink-0 rounded-lg bg-white px-3 text-sm font-semibold text-black disabled:opacity-40">Add</button></form> : undefined

    return <>
        <button type="button" aria-label="Client portal actions" aria-expanded={open} onClick={toggle} className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center text-neutral-400 outline-none transition hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-600">
            <ActionsIcon />
            {openCount ? <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-white px-1 text-center text-[10px] font-bold leading-4 text-black">{Math.min(openCount, 9)}{openCount > 9 ? "+" : ""}</span> : null}
        </button>
        {open ? <CenteredDialog title="Client portal" short busy={pending !== null} onClose={() => { setOpen(false); setEditingProgress(null) }} footer={addAction}>
            <p className="text-sm leading-5 text-neutral-500">Required actions and visible fulfilment progress</p>
            {progress ? <div className="mt-4">
                <button type="button" onClick={() => setEditingProgress(null)} className="mb-2 inline-flex min-h-9 items-center text-sm text-neutral-400 hover:text-white">← Back</button>
                <p className="truncate text-sm font-semibold">{progress.serviceName}</p>
                <div className="mt-4 rounded-xl border border-neutral-800 p-3"><ClientPortalProgressTimeline status={progress.status} surface="dark" /></div>
                <p className="mb-1 mt-5 text-xs font-semibold text-neutral-500">Update current step</p>
                <div className="grid gap-1">{statusOptions.map((status) => <button key={status} type="button" disabled={pending === progress.id} onClick={() => void update({ kind: "progress", id: progress.id, status, updatedAt: progress.updatedAt })} className={`flex min-h-11 items-center justify-between rounded-lg px-3 text-left text-sm hover:bg-neutral-900 disabled:opacity-50 ${progress.status === status ? "bg-neutral-900 text-white" : "text-neutral-300"}`}><span>{progressLabels[status]}</span>{progress.status === status ? <span aria-hidden="true">✓</span> : null}</button>)}</div>
            </div> : <div className="mt-5">
                <p className="text-xs font-semibold text-neutral-500">Required actions</p>
                {loading && !overview ? <p className="py-5 text-sm text-neutral-500">Loading actions…</p> : null}
                {!loading && overview && !actions.length ? <p className="py-5 text-sm text-neutral-500">No portal actions yet.</p> : null}
                {actions.length ? <ul className="mt-2 space-y-1">{actions.map((action) => <li key={action.id}><button type="button" disabled={pending === action.id} onClick={() => void update({ kind: "action", id: action.id, status: action.status === "open" ? "completed" : "open", updatedAt: action.updatedAt })} className={`flex min-h-11 w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-neutral-900 disabled:opacity-50 ${action.status === "completed" ? "text-neutral-500" : "text-neutral-200"}`}><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${action.status === "completed" ? "border-neutral-600 bg-neutral-700 text-xs text-white" : "border-neutral-600"}`}>{action.status === "completed" ? "✓" : ""}</span><span className={`text-sm leading-5 ${action.status === "completed" ? "line-through" : ""}`}>{action.title}</span></button></li>)}</ul> : null}
                {overview?.progress.length ? <div className="mt-5 border-t border-neutral-800 pt-4"><p className="text-xs font-semibold text-neutral-500">Fulfilment progress</p><ul className="mt-2 space-y-1">{overview.progress.map((item) => <li key={item.id}><button type="button" onClick={() => setEditingProgress(item.id)} className="flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-lg px-2 text-left hover:bg-neutral-900"><span className="min-w-0 truncate text-sm text-neutral-200">{item.serviceName}</span><Status label={progressLabels[item.status]} tone={item.status === "live" || item.status === "complete" ? "green" : item.status === "preparing" ? "grey" : "yellow"} /></button></li>)}</ul></div> : null}
            </div>}
            {error ? <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        </CenteredDialog> : null}
    </>
}
