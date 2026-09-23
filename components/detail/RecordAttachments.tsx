"use client"

import Link from "@/components/workspace/WorkspaceLink"
import { useCallback, useEffect, useRef, useState } from "react"
import { attachExistingRecord } from "@/app/[workspaceSlug]/attachment-actions"
import { SelectorOption } from "@/components/ui/Selector"
import { AnchoredPopup } from "@/components/ui/AnchoredPopup"
import { AddDocumentCard, DocumentCard, DocumentCatalogue } from "@/components/ui/DocumentCatalogue"
import type { AttachmentChoice, AttachmentItem, AttachmentOwner, AttachmentPage } from "@/lib/record-attachments"
import { createAttachmentPageCache, createAttachmentReadOwner } from "@/lib/attachment-reads"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"

type Props = { workspaceSlug: string; userId: string; owner: AttachmentOwner; ownerId: string; canEdit: boolean; initialAssets?: AttachmentItem[] }
const retained = createAttachmentPageCache<AttachmentPage<AttachmentItem>>()
const scopeKey = (p: Props) => `${p.userId}:${p.workspaceSlug}:${p.owner}:${p.ownerId}`
export function RecordAttachments(props: Props) { return <ScopedAttachments key={scopeKey(props)} {...props} /> }

function ScopedAttachments(props: Props) {
    const { workspaceSlug, userId, owner, ownerId, canEdit, initialAssets = [] } = props
    const key = scopeKey(props), section = useRef<HTMLElement>(null), mounted = useRef(true), busyRef = useRef(false)
    const itemRequest = useRef(0), choiceRequest = useRef(0)
    const active = useWorkspaceNavigation()?.active !== false
    const [visible, setVisible] = useState(false)
    const [page, setPage] = useState<AttachmentPage<AttachmentItem> | null>(() => retained.get(key)?.page ?? (initialAssets.length ? { items: initialAssets, nextCursor: null } : null))
    const [choicePage, setChoicePage] = useState<AttachmentPage<AttachmentChoice> | null>(null)
    const [anchor, setAnchor] = useState<HTMLElement | null>(null), [step, setStep] = useState<"actions" | "pick">("actions")
    const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [choiceCursor, setChoiceCursor] = useState<string | null>(null)
    const [itemCursor, setItemCursor] = useState<string | null>(() => retained.get(key)?.cursor ?? null), [loading, setLoading] = useState(false), [choicesLoading, setChoicesLoading] = useState(false)
    const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [choiceError, setChoiceError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [readers] = useState(() => {
        async function read<T>(url: string, signal: AbortSignal): Promise<AttachmentPage<T>> {
            const response = await fetch(url, { signal, cache: "no-store", redirect: "error", headers: { "x-workspace-user": userId } })
            if (!response.ok) throw new Error("Attachments could not load. Retry when ready.")
            return await response.json() as AttachmentPage<T>
        }
        return { items: createAttachmentReadOwner(read<AttachmentItem>), choices: createAttachmentReadOwner(read<AttachmentChoice>) }
    })
    const url = useCallback((view: "items" | "choices", cursor?: string | null, q = "") => {
        const params = new URLSearchParams({ owner, ownerId, view })
        if (cursor) params.set("cursor", cursor)
        if (q) params.set("q", q)
        return `/api/workspaces/${encodeURIComponent(workspaceSlug)}/attachments?${params}`
    }, [owner, ownerId, workspaceSlug])
    const load = useCallback(async (cursor: string | null = null) => {
        const request = ++itemRequest.current
        setLoading(true)
        try {
            const next = await readers.items.read(url("items", cursor))
            if (!next || !mounted.current) return
            retained.set(key, next, cursor)
            setPage(next); setItemCursor(cursor); setError(null)
        } finally { if (mounted.current && request === itemRequest.current) setLoading(false) }
    }, [key, readers, url])
    const loadChoices = useCallback(async () => {
        const request = ++choiceRequest.current
        setChoicesLoading(true); setChoiceError(null)
        try {
            const next = await readers.choices.read(url("choices", choiceCursor, search))
            if (next && mounted.current) setChoicePage(next)
        } catch (cause) { if (mounted.current && request === choiceRequest.current) setChoiceError(cause instanceof Error ? cause.message : "Choices could not load.") }
        finally { if (mounted.current && request === choiceRequest.current) setChoicesLoading(false) }
    }, [readers, url, choiceCursor, search])
    useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false; readers.items.cancel(); readers.choices.cancel() }
    }, [readers])
    useEffect(() => {
        const node = section.current
        if (!node) return
        const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: "240px" })
        observer.observe(node)
        return () => observer.disconnect()
    }, [])
    useEffect(() => {
        if (!active) { readers.items.cancel(); readers.choices.cancel(); return }
        if (!visible || (retained.has(key) && Date.now() - retained.get(key)!.at < 5000)) return
        let retired = false
        void Promise.resolve().then(() => { if (!retired) return load() }).catch(cause => { if (mounted.current && !retired) setError(cause.message) })
        return () => { retired = true; readers.items.cancel() }
    }, [active, visible, key, load, readers])
    useEffect(() => {
        let retired = false
        if (anchor && step === "pick" && active) void Promise.resolve().then(() => { if (!retired) return loadChoices() })
        else readers.choices.cancel()
        return () => { retired = true; readers.choices.cancel() }
    }, [anchor, step, active, loadChoices, readers])
    async function attach(choice: AttachmentChoice) {
        if (busyRef.current) return
        busyRef.current = true; setBusy(true); setError(null); setNotice(null)
        readers.items.cancel()
        try {
            const result = await runWorkspaceMutation(() => attachExistingRecord(workspaceSlug, owner, ownerId, choice.kind, choice.id, userId), { category: "system" })
            if (!mounted.current) return
            if (!result.ok) { setChoiceError(result.error); return }
            setNotice("Attachment linked."); setAnchor(null)
            // The write is authoritative even if its subsequent optional read fails.
            setPage(prior => ({ items: [{ ...choice, previewUrl: null }, ...(prior?.items.filter(item => item.id !== choice.id || item.kind !== choice.kind) ?? [])].slice(0, 40), nextCursor: prior?.nextCursor ?? null }))
            retained.delete(key)
            try { await load() } catch { if (mounted.current) setError("Attachment linked, but the list could not refresh. Retry loading the list.") }
        } catch { if (mounted.current) setChoiceError("The attachment could not be confirmed. Retry this selection; an existing link will not be duplicated.") }
        finally { busyRef.current = false; if (mounted.current) setBusy(false) }
    }
    const creationQuery = `attachTo=${encodeURIComponent(owner)}&attachId=${encodeURIComponent(ownerId)}`
    const choices = choicePage?.items.filter(choice => !page?.items.some(item => item.id === choice.id && item.kind === choice.kind)) ?? []
    return <section ref={section} className="mt-6 border-t border-neutral-900 pt-5" aria-label="Attachments">
        <h2 className="text-lg font-semibold text-white">Attachments</h2><p className="mt-1 text-xs text-neutral-500">Assets and notes linked to this record.</p>
        {notice ? <p role="status" className="mt-2 text-xs text-neutral-300">{notice}</p> : null}
        {error ? <p role="alert" className="mt-2 text-xs text-red-300">{error} <button type="button" onClick={() => void load(itemCursor).catch(cause => setError(cause.message))} className="underline">Retry loading</button></p> : null}
        <div className="mt-4"><DocumentCatalogue label="Attached assets and notes">
            {(page?.items ?? []).map(item => <DocumentCard key={`${item.kind}:${item.id}`} href={`/${workspaceSlug}/${item.kind === "asset" ? "assets" : "notes"}/${item.id}`} title={item.title} format={item.kind === "asset" ? "Asset" : "Note"} detail={item.detail} previewUrl={item.previewUrl} />)}
            {canEdit ? <AddDocumentCard label="Add attachment" onClick={event => { setAnchor(event.currentTarget); setStep("actions"); setChoiceError(null) }} /> : null}
        </DocumentCatalogue></div>
        {loading ? <p className="mt-3 text-xs text-neutral-500" role="status">Loading attachments…</p> : page?.items.length === 0 ? <p className="mt-3 text-xs text-neutral-500">No attachments on this page.</p> : null}
        {itemCursor || page?.nextCursor ? <nav className="mt-3 flex gap-4 text-xs text-neutral-300" aria-label="Attachment pages">{itemCursor ? <button type="button" disabled={loading} onClick={() => void load().catch(cause => setError(cause.message))}>Newest attachments</button> : null}{page?.nextCursor ? <button type="button" disabled={loading} onClick={() => void load(page.nextCursor).catch(cause => setError(cause.message))}>Older attachments</button> : null}</nav> : null}
        {anchor ? <AnchoredPopup anchor={anchor} onDismiss={() => setAnchor(null)} role="dialog" className="w-[min(23rem,calc(100vw-2rem))] rounded-xl border border-neutral-700 bg-neutral-950 p-3 shadow-2xl">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-white">{step === "actions" ? "Add attachment" : "Choose an existing record"}</h3>{step === "pick" ? <button type="button" onClick={() => setStep("actions")} className="text-xs text-neutral-400 underline">Back</button> : null}</div>
            {step === "actions" ? <div className="mt-3 grid gap-1 text-sm"><Link href={`/${workspaceSlug}/assets?create=asset&${creationQuery}`} className="rounded-lg px-3 py-2 text-neutral-200 hover:bg-neutral-900">New asset</Link><Link href={`/${workspaceSlug}/notes?create=note&${creationQuery}`} className="rounded-lg px-3 py-2 text-neutral-200 hover:bg-neutral-900">New note</Link><button type="button" onClick={() => setStep("pick")} className="rounded-lg px-3 py-2 text-left text-neutral-200 hover:bg-neutral-900">Pick existing asset or note</button></div> : <div className="mt-3">
                <form onSubmit={event => { event.preventDefault(); readers.choices.cancel(); setChoicePage(null); setChoiceCursor(null); setSearch(query.trim()); if (search === query.trim() && !choiceCursor) void loadChoices() }} className="flex gap-2"><input value={query} onChange={event => setQuery(event.target.value)} maxLength={120} placeholder="Search assets and notes" aria-label="Search assets and notes" className="h-9 min-w-0 flex-1 rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white outline-none" /><button type="submit" className="text-xs text-neutral-300">Search</button></form>
                {choiceError ? <p role="alert" className="mt-2 text-xs text-red-300">{choiceError} <button type="button" onClick={() => void loadChoices()} className="underline">Retry</button></p> : null}
                <div role="listbox" aria-label="Existing assets and notes" className="mt-2 max-h-64 overflow-y-auto">{choices.map(choice => <SelectorOption key={`${choice.kind}:${choice.id}`} showCheck={false} description={choice.kind === "note" ? "Note" : choice.detail} disabled={busy || choicesLoading} onClick={() => void attach(choice)}>{choice.title}</SelectorOption>)}{choicesLoading ? <p role="status" className="px-3 py-3 text-xs text-neutral-500">Loading choices…</p> : !choices.length && !choiceError ? <p className="px-3 py-3 text-xs text-neutral-500">No available records on this page.</p> : null}</div>
                <nav className="mt-2 flex gap-4 text-xs text-neutral-300" aria-label="Attachment choice pages">{choiceCursor ? <button type="button" disabled={choicesLoading || busy} onClick={() => { setChoicePage(null); setChoiceCursor(null) }}>Newest choices</button> : null}{choicePage?.nextCursor ? <button type="button" disabled={choicesLoading || busy} onClick={() => { setChoicePage(null); setChoiceCursor(choicePage.nextCursor) }}>Older choices</button> : null}</nav>
            </div>}
        </AnchoredPopup> : null}
    </section>
}
