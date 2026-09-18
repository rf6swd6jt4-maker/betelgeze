"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { DetailField, DetailFields } from "@/components/detail"
import { AutoGrowTextarea } from "@/components/ui"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { registerWorkspaceAutosaveFlusher, runWorkspaceMutation } from "@/lib/workspace-mutations"
import { updateAssetFields } from "./actions"

type Draft = { title: string; description: string }
type StoredDraft = { version: string; values: Draft }

const same = (left: Draft, right: Draft) => left.title === right.title && left.description === right.description
const fieldClass = "min-h-9 w-full min-w-0 rounded-md bg-transparent px-1 py-1 text-base text-neutral-200 outline-none hover:bg-neutral-900/60 focus:bg-neutral-900 disabled:opacity-70 sm:text-sm"

export function AssetFieldsEditor({ workspaceSlug, assetId, userId, initialTitle, initialDescription, updatedAt, canEdit, children }: {
    workspaceSlug: string
    assetId: string
    userId: string
    initialTitle: string
    initialDescription: string
    updatedAt: string
    canEdit: boolean
    children: ReactNode
}) {
    const initial = { title: initialTitle, description: initialDescription }
    const router = useRouter()
    const storageKey = `betelgeze:asset-draft:${userId}:${workspaceSlug}:${assetId}`
    const [draft, setDraftState] = useState(initial)
    const [status, setStatus] = useState<"saved" | "dirty" | "saving" | "error" | "conflict">("saved")
    const [error, setError] = useState("")
    const [latest, setLatest] = useState<{ version: string; values: Draft } | null>(null)
    const draftRef = useRef(initial)
    const baselineRef = useRef(initial)
    const versionRef = useRef(updatedAt)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const runningRef = useRef<Promise<boolean> | null>(null)

    const persist = useCallback((values: Draft, version = versionRef.current) => {
        try { localStorage.setItem(storageKey, JSON.stringify({ version, values } satisfies StoredDraft)); return true }
        catch { setError("Device storage is unavailable. Keep this page open until the asset saves."); setStatus("error"); return false }
    }, [storageKey])

    const clearPersisted = useCallback(() => {
        try { localStorage.removeItem(storageKey) } catch { /* A confirmed server save remains authoritative. */ }
    }, [storageKey])

    const flush = useCallback(async () => {
        if (!canEdit) return true
        if (runningRef.current) return runningRef.current
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = null
        const run = (async () => {
            while (!same(draftRef.current, baselineRef.current)) {
                const values = draftRef.current
                if (!values.title.trim()) { setError("Add an asset name before saving."); setStatus("error"); return false }
                setStatus("saving")
                setError("")
                const result = await runWorkspaceMutation(() => updateAssetFields(workspaceSlug, assetId, {
                    title: values.title,
                    description: values.description,
                    expectedUpdatedAt: versionRef.current,
                    expectedUserId: userId,
                }), { category: "system" }).catch(() => null)
                if (!result?.ok) {
                    setError(result?.error ?? "The save could not be confirmed. Your asset draft is preserved for retry.")
                    setStatus(result?.conflict ? "conflict" : "error")
                    setLatest(result?.conflict && result.version && result.values ? { version: result.version, values: result.values } : null)
                    persist(draftRef.current)
                    return false
                }
                baselineRef.current = result.values
                versionRef.current = result.version
                if (!same(draftRef.current, values)) persist(draftRef.current, result.version)
                if (same(draftRef.current, values)) {
                    draftRef.current = result.values
                    setDraftState(result.values)
                }
            }
            clearPersisted()
            setLatest(null)
            setStatus("saved")
            return true
        })().finally(() => { runningRef.current = null })
        runningRef.current = run
        return run
    }, [assetId, canEdit, clearPersisted, persist, userId, workspaceSlug])

    const edit = useCallback((change: Partial<Draft>) => {
        const next = { ...draftRef.current, ...change }
        draftRef.current = next
        setDraftState(next)
        setError("")
        setStatus("dirty")
        persist(next)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => { timerRef.current = null; void flush() }, 800)
    }, [flush, persist])

    useEffect(() => {
        let cancelled = false
        try {
            const raw = localStorage.getItem(storageKey)
            if (raw) {
                const saved = JSON.parse(raw) as StoredDraft
                if (saved?.version === updatedAt && typeof saved.values?.title === "string" && typeof saved.values?.description === "string") {
                    draftRef.current = saved.values
                    queueMicrotask(() => { if (!cancelled) { setDraftState(saved.values); setStatus("dirty") } })
                    timerRef.current = setTimeout(() => { timerRef.current = null; void flush() }, 800)
                } else {
                    queueMicrotask(() => { if (!cancelled) { setError("A saved draft belongs to an older asset version. Refresh and review before retrying it."); setStatus("conflict"); setLatest({ version: updatedAt, values: { title: initialTitle, description: initialDescription } }) } })
                }
            }
        } catch { queueMicrotask(() => { if (!cancelled) { setError("The saved asset draft could not be restored. Keep this page open."); setStatus("error") } }) }
        const unregister = registerWorkspaceAutosaveFlusher(flush, { checkpoint: () => same(draftRef.current, baselineRef.current) || persist(draftRef.current) })
        const beforeUnload = (event: BeforeUnloadEvent) => { if (!same(draftRef.current, baselineRef.current)) { event.preventDefault(); event.returnValue = "" } }
        window.addEventListener("beforeunload", beforeUnload)
        return () => {
            cancelled = true
            unregister()
            window.removeEventListener("beforeunload", beforeUnload)
            if (timerRef.current) clearTimeout(timerRef.current)
            void flush()
        }
    }, [flush, initialDescription, initialTitle, persist, storageKey, updatedAt])

    return <section aria-label="Asset information" className="mt-4 border-b border-neutral-800">
        <DetailFields className="!mt-0">
            <DetailField label="Name" icon="identity"><input aria-label="Asset name" disabled={!canEdit} value={draft.title} maxLength={500} onChange={(event) => edit({ title: event.target.value })} onBlur={() => void flush()} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur() } }} className={fieldClass} /></DetailField>
            {children}
            <DetailField multiline label="Description" icon="description" className="lg:col-span-2"><AutoGrowTextarea aria-label="Asset description" disabled={!canEdit} rows={3} maxLength={20_000} value={draft.description} onChange={(event) => edit({ description: event.target.value })} onBlur={() => void flush()} placeholder="Add asset context…" className={fieldClass} /></DetailField>
        </DetailFields>
        <div className="flex min-h-9 items-center justify-between gap-3 py-2 text-xs">
            <p role="status" className={status === "error" || status === "conflict" ? "text-red-300" : "text-neutral-400"}>{error || (status === "saving" ? "Saving asset details…" : status === "dirty" ? "Asset details will save automatically" : canEdit ? "Asset details saved" : "Read only")}</p>
            {status === "error" ? <button type="button" onClick={() => void flush()} className="min-h-9 text-red-200 underline decoration-red-500/50 underline-offset-2 hover:text-white">Retry</button> : null}
            {status === "conflict" ? <span className="flex items-center gap-3">{latest ? <><button type="button" onClick={() => { baselineRef.current = latest.values; draftRef.current = latest.values; versionRef.current = latest.version; setDraftState(latest.values); setLatest(null); setError(""); setStatus("saved"); clearPersisted() }} className="min-h-9 text-amber-200 underline decoration-amber-500/50 underline-offset-2 hover:text-white">Use saved fields</button><button type="button" onClick={() => { baselineRef.current = latest.values; versionRef.current = latest.version; setLatest(null); setError(""); setStatus("dirty"); persist(draftRef.current, latest.version); void flush() }} className="min-h-9 text-amber-200 underline decoration-amber-500/50 underline-offset-2 hover:text-white">Keep my edits</button></> : <button type="button" onClick={() => router.refresh()} className="min-h-9 text-amber-200 underline decoration-amber-500/50 underline-offset-2 hover:text-white">Refresh</button>}</span> : null}
        </div>
    </section>
}
