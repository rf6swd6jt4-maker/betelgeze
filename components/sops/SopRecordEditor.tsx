"use client"
import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone } from "@/components/detail"
import type { SopRecord } from "@/lib/sops/records-policy"
import { sopButtonClass, sopCommand, sopInputClass, sopTabKey, useSopDraft } from "./client"
export function SopRecordEditor({ workspaceSlug, workspaceId, userId, sop, mode }: { workspaceSlug: string; workspaceId: string; userId: string; sop: SopRecord; mode: "fields" | "danger" }) {
    const router = useRouter(), busyRef = useRef(false)
    const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("")
    const { stored, write } = useSopDraft(`sop-edit:${workspaceId}:${userId}:${sop.id}:${sopTabKey()}`)
    let draft = { title: sop.title, description: sop.description, version: sop.version }
    try { const saved = JSON.parse(stored ?? "null"); if (saved && typeof saved.title === "string" && typeof saved.description === "string" && Number.isInteger(saved.version)) draft = saved } catch { /* Ignore malformed local storage. */ }
    function update(patch: Partial<typeof draft>) { try { write({ ...draft, ...patch }); setError("") } catch { setError("Your draft could not be saved in this browser.") } }
    async function save(archived: boolean, details = draft) {
        if (busyRef.current) return
        busyRef.current = true; setBusy(true); setError("")
        try { await sopCommand(`/api/workspaces/${workspaceSlug}/sops/${sop.id}`, { ...details, archived }, "PATCH"); if (mode === "fields") write(null); setOpen(false); router.refresh() }
        catch (e) { setError(e instanceof Error ? e.message : "Could not save SOP.") }
        finally { busyRef.current = false; setBusy(false) }
    }
    if (mode === "danger") return <DetailDangerZone><DetailDangerAction title={sop.archived_at ? "Restore SOP" : "Archive SOP"} description={sop.archived_at ? "Return this SOP to the active catalogue." : "Remove this SOP from the active catalogue. Assets and interpretations remain available."} control={<DetailDangerButton disabled={busy} onClick={() => { if (sop.archived_at || window.confirm(`Archive “${sop.title}”? Assets and history will be preserved.`)) void save(!sop.archived_at, { title: sop.title, description: sop.description, version: sop.version }) }}>{busy ? "Saving…" : sop.archived_at ? "Restore SOP" : "Archive SOP"}</DetailDangerButton>} />{error ? <p role="alert" className="py-3 text-sm text-red-300">{error}</p> : null}<DetailDangerAction title="Delete SOP permanently" description="Permanent deletion is unavailable while source and interpretation history are retained." control={<DetailDangerButton tone="delete" disabled>Delete permanently</DetailDangerButton>} /></DetailDangerZone>
    return <div className="mt-4">
        {!sop.archived_at && !(open || stored) ? <button type="button" onClick={() => setOpen(true)} className="min-h-10 text-sm text-neutral-400 hover:text-white">Edit SOP details</button> : null}
        {!sop.archived_at && (open || stored) ? <form className="max-w-xl space-y-3" onSubmit={e => { e.preventDefault(); void save(false) }}>
            <label className="block text-xs text-neutral-500">Name<input required maxLength={200} value={draft.title} disabled={busy} onChange={e => update({ title: e.target.value })} className={`${sopInputClass} mt-1`} /></label>
            <label className="block text-xs text-neutral-500">Description<textarea rows={3} maxLength={5000} value={draft.description} disabled={busy} onChange={e => update({ description: e.target.value })} className={`${sopInputClass} mt-1`} /></label>
            {draft.version !== sop.version ? <p className="text-xs text-amber-200">This SOP changed since the draft began. Copy your edits, then discard the draft to use the latest version.</p> : null}
            <div className="flex gap-3"><button className={sopButtonClass} disabled={busy || draft.version !== sop.version}>{busy ? "Saving…" : "Save details"}</button><button type="button" disabled={busy} className="min-h-10 px-2 text-sm text-neutral-400" onClick={() => { try { write(null); setOpen(false) } catch { setError("Could not clear the draft.") } }}>Discard draft</button></div>
        </form> : null}
        {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error}</p> : null}
    </div>
}
