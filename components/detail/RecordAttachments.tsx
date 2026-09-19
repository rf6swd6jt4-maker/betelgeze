"use client"

import Link from "@/components/workspace/WorkspaceLink"
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react"
import { attachExistingRecord } from "@/app/[workspaceSlug]/attachment-actions"
import { AnchoredPopup } from "@/components/ui/AnchoredPopup"
import { AddDocumentCard, DocumentCard, DocumentCatalogue } from "@/components/ui/DocumentCatalogue"
import type { AttachmentItem, AttachmentOwner } from "@/lib/record-attachments"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"

type Choice = { id: string; kind: "asset" | "note"; title: string; detail: string }
type Snapshot = { items: AttachmentItem[]; choices: Choice[] | null }
const retained = new Map<string, { snapshot: Snapshot; at: number }>()
const EMPTY_ASSETS: AttachmentItem[] = []

export function RecordAttachments({ workspaceSlug, userId, owner, ownerId, canEdit, initialAssets = EMPTY_ASSETS }: { workspaceSlug: string; userId: string; owner: AttachmentOwner; ownerId: string; canEdit: boolean; initialAssets?: AttachmentItem[] }) {
    const sectionRef = useRef<HTMLElement>(null)
    const [visible, setVisible] = useState(false)
    const navigation = useWorkspaceNavigation()
    const active = navigation?.active !== false
    const key = `${userId}:${workspaceSlug}:${owner}:${ownerId}`
    const initialAssetsRef = useRef(initialAssets)
    const [snapshot, setSnapshot] = useState<Snapshot | null>(() => retained.get(key)?.snapshot ?? (initialAssets.length ? { items: initialAssets, choices: null } : null))
    const initialOnly = useRef(initialAssets.length > 0 && !retained.has(key))
    const [anchor, setAnchor] = useState<HTMLElement | null>(null)
    const [step, setStep] = useState<"actions" | "pick">("actions")
    const [query, setQuery] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async (choices = false) => {
        const params = new URLSearchParams({ owner, ownerId })
        if (choices) params.set("choices", "1")
        const skipAssets = initialOnly.current
        if (skipAssets) params.set("skipAssets", "1")
        initialOnly.current = false
        const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/attachments?${params}`, { cache: "no-store", headers: { "x-workspace-user": userId } })
        if (!response.ok) throw new Error("Attachments could not load.")
        const next = await response.json() as Snapshot
        if (skipAssets) next.items = [...initialAssetsRef.current, ...next.items]
        retained.set(key, { snapshot: next, at: Date.now() })
        while (retained.size > 30) retained.delete(retained.keys().next().value!)
        setSnapshot(next); setError(null)
        return next
    }, [key, workspaceSlug, userId, owner, ownerId])

    useEffect(() => {
        const node = sectionRef.current
        if (!node) return
        const observer = new IntersectionObserver((entries) => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: "240px" })
        observer.observe(node)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        if (!active || !visible) return
        const previous = retained.get(key)
        if (previous && Date.now() - previous.at < 5_000) return
        void Promise.resolve().then(() => load()).catch((cause) => setError(cause instanceof Error ? cause.message : "Attachments could not load."))
    }, [active, visible, key, load])

    const open = async (event: MouseEvent<HTMLButtonElement>) => {
        setAnchor(event.currentTarget); setStep("actions"); setError(null)
        if (!snapshot?.choices) {
            try { await load(true) } catch { setError("Attachment choices could not load.") }
        }
    }
    const attach = async (choice: Choice) => {
        setBusy(true); setError(null)
        try {
            const result = await runWorkspaceMutation(() => attachExistingRecord(workspaceSlug, owner, ownerId, choice.kind, choice.id), { category: "system" })
            if (!result.ok) { setError(result.error); return }
            await load(true)
            setAnchor(null)
        } catch { setError("The attachment could not be added. Try again.") }
        finally { setBusy(false) }
    }
    const choices = snapshot?.choices?.filter((choice) => !snapshot.items.some((item) => item.id === choice.id && item.kind === choice.kind) && `${choice.title} ${choice.detail}`.toLowerCase().includes(query.toLowerCase())) ?? []
    const creationQuery = `attachTo=${encodeURIComponent(owner)}&attachId=${encodeURIComponent(ownerId)}`
    return <section ref={sectionRef} className="mt-6 border-t border-neutral-900 pt-5" aria-label="Attachments">
        <h2 className="text-lg font-semibold text-white">Attachments</h2>
        <p className="mt-1 text-xs text-neutral-500">Assets and notes linked to this record.</p>
        {error ? <p role="alert" className="mt-2 text-xs text-red-300">{error}</p> : null}
        <div className="mt-4"><DocumentCatalogue label="Attached assets and notes">
            {(snapshot?.items ?? []).map((item) => <DocumentCard key={`${item.kind}:${item.id}`} href={`/${workspaceSlug}/${item.kind === "asset" ? "assets" : "notes"}/${item.id}`} title={item.title} format={item.kind === "asset" ? "Asset" : "Note"} detail={item.detail} previewUrl={item.previewUrl} />)}
            {canEdit ? <AddDocumentCard label="Add attachment" onClick={(event) => void open(event)} /> : null}
        </DocumentCatalogue></div>
        {!snapshot && !error ? <p className="mt-3 text-xs text-neutral-500">Loading attachments…</p> : snapshot && snapshot.items.length === 0 && !canEdit ? <p className="mt-3 text-xs text-neutral-500">No attachments yet.</p> : null}
        {anchor ? <AnchoredPopup anchor={anchor} onDismiss={() => setAnchor(null)} role="dialog" className="w-[min(23rem,calc(100vw-2rem))] rounded-xl border border-neutral-700 bg-neutral-950 p-3 shadow-2xl">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-white">{step === "actions" ? "Add attachment" : "Choose an existing record"}</h3>{step === "pick" ? <button type="button" onClick={() => setStep("actions")} className="text-xs text-neutral-400 underline">Back</button> : null}</div>
            {step === "actions" ? <div className="mt-3 grid gap-1 text-sm">
                <Link href={`/${workspaceSlug}/assets?create=asset&${creationQuery}`} className="rounded-lg px-3 py-2 text-neutral-200 hover:bg-neutral-900">New asset</Link>
                <Link href={`/${workspaceSlug}/notes?create=note&${creationQuery}`} className="rounded-lg px-3 py-2 text-neutral-200 hover:bg-neutral-900">New note</Link>
                <button type="button" onClick={() => setStep("pick")} className="rounded-lg px-3 py-2 text-left text-neutral-200 hover:bg-neutral-900">Pick existing asset or note</button>
            </div> : <div className="mt-3"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets and notes" aria-label="Search assets and notes" className="h-9 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white outline-none" /><div className="mt-2 max-h-64 overflow-y-auto">{choices.map((choice) => <button key={`${choice.kind}:${choice.id}`} type="button" disabled={busy} onClick={() => void attach(choice)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-neutral-900 disabled:opacity-50"><span className="block truncate text-sm text-neutral-200">{choice.title}</span><span className="block truncate text-xs text-neutral-500">{choice.kind === "note" ? "Note" : choice.detail}</span></button>)}{!choices.length ? <p className="px-3 py-3 text-xs text-neutral-500">No available records found.</p> : null}</div></div>}
        </AnchoredPopup> : null}
    </section>
}
