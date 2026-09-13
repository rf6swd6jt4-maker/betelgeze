"use client"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Selector } from "@/components/ui/Selector"
import { registerWorkspaceAutosaveFlusher } from "@/lib/workspace-mutations"
import { SOP_ASSET_ACCEPT, SOP_SOURCE_LABELS, SOP_SOURCE_ROLES, validateSopAsset, type SopSourceRole } from "@/lib/sops/records-policy"
import { sopButtonClass, sopCommand, sopInputClass, sopTabKey, useSopDraft } from "./client"
type Pending = { receipt: string; name: string }
export function SopAssetUpload({ workspaceSlug, workspaceId, userId, sopId }: { workspaceSlug: string; workspaceId: string; userId: string; sopId: string }) {
    const router = useRouter(), input = useRef<HTMLInputElement>(null), busyRef = useRef(false)
    const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("")
    const key = `sop-assets:${workspaceId}:${userId}:${sopId}:${sopTabKey()}`
    const { stored, write } = useSopDraft(key), guidance = useSopDraft(`${key}:guidance`)
    let pending: Pending | null = null
    let role: SopSourceRole = "reference", notes = ""
    try { const p = JSON.parse(stored ?? "null"); if (typeof p?.receipt === "string" && typeof p?.name === "string") pending = p } catch { /* Ignore malformed storage. */ }
    try { const g = JSON.parse(guidance.stored ?? "null"); if (SOP_SOURCE_ROLES.includes(g?.role) && typeof g?.notes === "string") { role = g.role; notes = g.notes } } catch { /* Ignore malformed storage. */ }
    const endpoint = `/api/workspaces/${workspaceSlug}/sops/${sopId}/assets`
    useEffect(() => {
        const unregister = registerWorkspaceAutosaveFlusher(async () => !busyRef.current)
        const warn = (event: BeforeUnloadEvent) => { if (busyRef.current) { event.preventDefault(); event.returnValue = "" } }
        window.addEventListener("beforeunload", warn)
        return () => { unregister(); window.removeEventListener("beforeunload", warn) }
    }, [])
    function updateGuidance(nextRole: SopSourceRole, nextNotes: string) { try { guidance.write({ role: nextRole, notes: nextNotes }) } catch { setError("Your guidance could not be saved in this browser.") } }
    async function finish(value: Pending) {
        await sopCommand(endpoint, { action: "finish", receipt: value.receipt })
        write(null)
        setMessage(`${value.name} added.`)
    }
    async function upload(files: File[]) {
        if (busyRef.current || pending) return
        busyRef.current = true; setBusy(true); setError("")
        try {
            if (files.length > 10) throw new Error("Add up to 10 files at a time.")
            const normalized = files.map(file => validateSopAsset({ name: file.name, size: file.size, type: file.type }))
            for (let i = 0; i < files.length; i++) {
                setMessage(`Preparing ${i + 1} of ${files.length}…`)
                const prepared = await sopCommand(endpoint, { action: "prepare", file: normalized[i], role, notes })
                const value = { receipt: prepared.receipt as string, name: normalized[i].name }
                write(value) // Persist the recovery receipt before sending file bytes.
                setMessage(`Uploading ${i + 1} of ${files.length}: ${value.name}…`)
                const response = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": normalized[i].type }, body: files[i], signal: AbortSignal.timeout(15 * 60_000) })
                if (!response.ok) throw new Error("The transfer did not finish. Retry saving, or discard the pending upload and select the file again.")
                setMessage(`Saving ${value.name}…`)
                await finish(value)
            }
            guidance.write(null); setOpen(false)
        } catch (e) { setMessage(""); setError(`${e instanceof Error ? e.message : "Could not add assets."} Any remaining files were not uploaded.`) }
        finally { busyRef.current = false; setBusy(false); if (input.current) input.current.value = ""; router.refresh() }
    }
    async function retry() {
        if (!pending || busyRef.current) return
        busyRef.current = true; setBusy(true); setError(""); setMessage("Saving asset…")
        try { await finish(pending); router.refresh() }
        catch (e) { setError(e instanceof Error ? e.message : "Could not save asset."); setMessage("") }
        finally { busyRef.current = false; setBusy(false) }
    }
    return <div className="mt-4">
        <button type="button" className={sopButtonClass} disabled={busy} onClick={() => setOpen(v => !v)}>Add assets</button>
        {open || guidance.stored ? <div className="mt-4 max-w-xl space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
            <p className="text-xs leading-5 text-neutral-500">PDF, DOCX, text, images, presentations and spreadsheets up to 50 MB. Video and audio up to 250 MB. Add up to 10 at a time.</p>
            <div><p className="mb-1 text-xs text-neutral-500">How should these assets be used?</p><Selector appearance="input" ariaLabel="Asset role" value={role} disabled={busy || Boolean(pending)} options={SOP_SOURCE_ROLES.map(value => ({ value, label: SOP_SOURCE_LABELS[value] }))} onChange={value => updateGuidance(value as SopSourceRole, notes)} /></div>
            <label className="block text-xs text-neutral-500">Guidance (optional)<textarea value={notes} maxLength={2000} rows={2} disabled={busy || Boolean(pending)} onChange={e => updateGuidance(role, e.target.value)} className={`${sopInputClass} mt-1`} placeholder="Industry, when this applies, or which document this revises" /></label>
            <input ref={input} type="file" aria-label="Choose SOP assets" accept={SOP_ASSET_ACCEPT} multiple disabled={busy || Boolean(pending)} onChange={e => { if (e.target.files?.length) void upload(Array.from(e.target.files)) }} className="block w-full min-w-0 text-sm text-neutral-400 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-800 file:px-3 file:py-2 file:text-sm file:text-white" />
        </div> : null}
        {pending && !busy ? <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-neutral-400"><span>Pending: {pending.name}</span><button type="button" className="min-h-10 text-white" onClick={() => void retry()}>Retry saving</button><button type="button" className="min-h-10" onClick={() => { if (window.confirm("Discard this pending upload receipt? Files already saved to this SOP will remain.")) { try { write(null); setMessage(""); setError("") } catch { setError("Could not discard the pending receipt.") } } }}>Discard pending upload</button></div> : null}
        {message ? <p role="status" className="mt-3 text-sm text-neutral-400">{message}</p> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
    </div>
}
