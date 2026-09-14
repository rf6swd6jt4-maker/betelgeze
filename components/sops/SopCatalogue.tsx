"use client"
import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AddDocumentCard, DocumentCard, DocumentCatalogue } from "@/components/ui/DocumentCatalogue"
import { AutoGrowTextarea } from "@/components/ui"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import type { SopRecord } from "@/lib/sops/records-policy"
import { sopButtonClass, sopCommand, sopInputClass, sopTabKey, useSopDraft } from "./client"
export function SopCatalogue({ workspaceSlug, workspaceId, userId, canAdd, items, next, paged, archived = false }: { workspaceSlug: string; workspaceId: string; userId: string; canAdd: boolean; items: Omit<SopRecord, "description">[]; next: string | null; paged: boolean; archived?: boolean }) {
    const router = useRouter(), busyRef = useRef(false)
    const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("")
    const { stored, write } = useSopDraft(`sop-create:${workspaceId}:${userId}:${sopTabKey()}`)
    let draft = { id: "", title: "", description: "" }
    try { const saved = JSON.parse(stored ?? "null"); if (saved && typeof saved.id === "string" && typeof saved.title === "string" && typeof saved.description === "string") draft = saved } catch { /* Ignore malformed draft. */ }
    function update(patch: Partial<typeof draft>) {
        try { write({ ...draft, id: draft.id || crypto.randomUUID(), ...patch }); setError("") } catch { setError("This browser could not save your draft. Enable browser storage before continuing.") }
    }
    async function create() {
        if (busyRef.current || !draft.title.trim()) return
        busyRef.current = true; setBusy(true); setError("")
        try {
            const result = await sopCommand(`/api/workspaces/${workspaceSlug}/sops`, draft)
            write(null)
            router.push(`/${workspaceSlug}/sops/${result.id}`)
        } catch (e) { setError(e instanceof Error ? e.message : "Could not create SOP.") }
        finally { busyRef.current = false; setBusy(false) }
    }
    return <section className="mt-5">
        <div className="mb-4 flex items-center justify-between gap-3 text-sm text-neutral-500"><p>{archived ? "Archived procedures" : "Your team's procedures and supporting material"}</p><Link href={`/${workspaceSlug}/sops${archived ? "" : "?archived=1"}`} prefetch={false} className="shrink-0 text-neutral-400 hover:text-white">{archived ? "Active SOPs" : "Archived"}</Link></div>
        {canAdd && (open || Boolean(stored)) ? <form onSubmit={e => { e.preventDefault(); void create() }} className="mb-5 max-w-xl space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
            <div><h2 className="text-sm font-medium text-white">Add SOP</h2><p className="mt-1 text-xs text-neutral-500">Name the procedure, then add its main document and supporting assets.</p></div>
            <label className="block text-xs text-neutral-400">Name<input autoFocus required maxLength={200} disabled={busy} value={draft.title} onChange={e => update({ title: e.target.value })} className={`${sopInputClass} mt-1.5`} placeholder="Meta ads fulfilment" /></label>
            <label className="block text-xs text-neutral-400">Description<AutoGrowTextarea maxLength={5000} rows={3} disabled={busy} value={draft.description} onChange={e => update({ description: e.target.value })} className={`${sopInputClass} mt-1.5`} placeholder="What this procedure covers and when to use it" /></label>
            <div className="flex items-center gap-3"><button disabled={busy || !draft.title.trim()} className={sopButtonClass}>{busy ? "Creating…" : "Create SOP"}</button><button type="button" disabled={busy} className="min-h-10 px-2 text-sm text-neutral-400" onClick={() => { try { write(null); setOpen(false) } catch { setError("Could not clear the draft.") } }}>Cancel</button></div>
        </form> : null}
        {error ? <p role="alert" className="mb-4 text-sm text-red-300">{error}</p> : null}
        <DocumentCatalogue label="SOP catalogue">
            {canAdd && !archived ? <AddDocumentCard label="Add SOP" disabled={busy} onClick={() => setOpen(true)} /> : null}
            {items.map(sop => <DocumentCard key={sop.id} href={`/${workspaceSlug}/sops/${sop.id}`} title={sop.title} format={sop.archived_at ? "Archived SOP" : "SOP"} detail={`Updated ${formatRelativeTime(sop.updated_at)}`} />)}
        </DocumentCatalogue>
        {!items.length ? <p className="mt-5 text-sm text-neutral-500">{archived ? "No archived SOPs." : "No SOPs yet. Admins can add procedures for the team."}</p> : null}
        {next || paged ? <nav aria-label="SOP catalogue pages" className="mt-5 flex gap-4 text-sm text-neutral-300">{paged ? <Link prefetch={false} href={`/${workspaceSlug}/sops${archived ? "?archived=1" : ""}`}>Newest SOPs</Link> : null}{next ? <Link prefetch={false} href={`/${workspaceSlug}/sops?cursor=${encodeURIComponent(next)}${archived ? "&archived=1" : ""}`}>Older SOPs</Link> : null}</nav> : null}
    </section>
}
