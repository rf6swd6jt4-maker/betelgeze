"use client"

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import Link from "@/components/workspace/WorkspaceLink"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { AssetGallery, AssetGalleryCard } from "@/components/ui/AssetGallery"
import { AnchoredPopup } from "@/components/ui/AnchoredPopup"
import { LibraryTabs } from "@/components/library/LibraryTabs"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { Status } from "@/components/ui/Status"
import type { ArchiveFileHandle } from "@/lib/assets/save-archive"
import { QuickStats } from "@/components/panel/QuickStats"
import { assetArchiveHref, MAX_ASSET_ARCHIVE_BYTES, MAX_ASSET_DOWNLOADS } from "@/lib/assets/download"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { serializeWorkspaceDetailPreview } from "@/lib/workspace-detail-preview"

type AssetEntry = {
    asset: { id: string; title: string; content_type: string | null; file_size: number | null; updated_at: string }
    previewUrl: string | null
    downloadHref: string | null
}
type AssetMenu = { entry: AssetEntry; anchor: HTMLElement; point: { x: number; y: number } }

const primaryActionClass = "inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-10 sm:px-3"

function formatFileSize(size: number | null) {
    if (size === null || !Number.isFinite(size) || size < 0) return "Unknown size"
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function AssetContextMenu({ menu, selected, busy, onSelect, onDownload, onDismiss }: {
    menu: AssetMenu; selected: boolean; busy: boolean; onSelect: () => void; onDownload: (event: MouseEvent<HTMLAnchorElement>) => void; onDismiss: () => void
}) {
    const menuRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true }))
        return () => cancelAnimationFrame(frame)
    }, [])
    function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            onDismiss()
            menu.anchor.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true })
            return
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
        const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
        if (!items.length) return
        event.preventDefault()
        const current = items.indexOf(menuRef.current?.ownerDocument.activeElement as HTMLElement)
        const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length
        items[index]?.focus()
    }
    const itemClass = "flex min-h-11 w-full items-center px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-900 focus-visible:bg-neutral-900 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    return <AnchoredPopup anchor={menu.anchor} anchorPoint={menu.point} onDismiss={onDismiss} className="w-44 rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/60">
        <div ref={menuRef} role="menu" aria-label={`Actions for ${menu.entry.asset.title}`} onKeyDown={onKeyDown}>
            <button type="button" role="menuitem" className={itemClass} disabled={!menu.entry.downloadHref} onClick={onSelect}>{selected ? "Deselect" : "Select"}</button>
            {menu.entry.downloadHref && !busy ? <a role="menuitem" className={itemClass} href={menu.entry.downloadHref} download target="_blank" rel="noreferrer" onClick={onDownload}>Download</a> : <button type="button" role="menuitem" className={itemClass} disabled title={busy ? "A ZIP save is in progress" : "No downloadable file"}>Download</button>}
        </div>
    </AnchoredPopup>
}

type Feedback = { kind: "requested" | "choosing" | "saving" | "saved" | "error" | "cancelled"; message: string; ids: string[] }
type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<ArchiveFileHandle>
const quietActionClass = "min-h-11 px-2 text-sm text-neutral-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-10"

export function AssetLibrary({ workspaceSlug, previewEntries, counts }: {
    workspaceSlug: string
    previewEntries: AssetEntry[]
    counts: { total: number; images: number; documents: number; uploads: number }
}) {
    const active = useWorkspaceNavigation()?.active !== false
    const [previousActive, setPreviousActive] = useState(active)
    const [selecting, setSelecting] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
    const [previousEntries, setPreviousEntries] = useState(previewEntries)
    if (previewEntries !== previousEntries) {
        setPreviousEntries(previewEntries)
        const readable = new Set(previewEntries.filter(entry => entry.downloadHref).map(entry => entry.asset.id))
        setSelectedIds(current => new Set([...current].filter(id => readable.has(id))))
    }
    const [menu, setMenu] = useState<AssetMenu | null>(null)
    const [feedback, setFeedback] = useState<Feedback | null>(null)
    const [canSaveZip, setCanSaveZip] = useState(false)
    const selectRef = useRef<HTMLButtonElement>(null)
    const nativeRequested = useRef<string | null>(null)
    const saveAttempt = useRef<AbortController | null>(null)
    const currentEntries = useRef(previewEntries)
    useLayoutEffect(() => { currentEntries.current = previewEntries }, [previewEntries])
    useEffect(() => () => { saveAttempt.current?.abort(); saveAttempt.current = null }, [])
    if (active !== previousActive) {
        setPreviousActive(active)
        if (!active) setMenu(null)
    }
    // Selection and recovery use the current authorized cards, never a stored URL.
    const available = previewEntries.filter(entry => entry.downloadHref)
    const selected = available.filter(entry => selectedIds.has(entry.asset.id))
    const knownBytes = selected.reduce((bytes, entry) => bytes + Math.max(0, entry.asset.file_size ?? 0), 0)
    const unknownSizes = selected.filter(entry => entry.asset.file_size === null).length
    const archiveTooLarge = selected.length > 1 && knownBytes > MAX_ASSET_ARCHIVE_BYTES
    const tooMany = selected.length > MAX_ASSET_DOWNLOADS
    const busy = feedback?.kind === "choosing" || feedback?.kind === "saving"
    const downloadHref = archiveTooLarge || tooMany ? null : selected.length === 1 ? selected[0].downloadHref : selected.length > 1 ? assetArchiveHref(workspaceSlug, selected.map(entry => entry.asset.id)) : null
    function enterSelection() {
        nativeRequested.current = null
        setSelecting(true)
        setCanSaveZip(typeof (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker === "function")
    }
    function toggle(id: string) {
        nativeRequested.current = null
        setSelectedIds(current => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }
    function nativeDownload(event: MouseEvent<HTMLAnchorElement>, entries: AssetEntry[]) {
        const requestKey = entries.map(entry => entry.asset.id).join(",")
        if (nativeRequested.current === requestKey || saveAttempt.current || !entries.length) { event.preventDefault(); return }
        nativeRequested.current = requestKey
        setMenu(null)
        setFeedback({ kind: "requested", message: "Download requested. Check your browser’s downloads or Files app.", ids: entries.map(entry => entry.asset.id) })
        const requestedIds = new Set(entries.map(entry => entry.asset.id))
        const remaining = selected.filter(entry => !requestedIds.has(entry.asset.id))
        setSelectedIds(new Set(remaining.map(entry => entry.asset.id)))
        setSelecting(selecting && remaining.length > 0)
        // Keep the native anchor request; no preflight, fetch, blob or extra request.
        requestAnimationFrame(() => { if (selectRef.current?.isConnected) selectRef.current.focus({ preventScroll: true }) })
    }
    function selectAgain(ids: string[]) {
        const readable = new Set(available.map(entry => entry.asset.id))
        if (ids.some(id => !readable.has(id))) {
            setFeedback({ kind: "error", message: "Some files are no longer available. Select files again.", ids: [] })
            return
        }
        enterSelection()
        setSelectedIds(new Set(ids))
        setFeedback(null)
    }
    function saveZip() {
        if (saveAttempt.current || !downloadHref || selected.length < 2) return
        const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker
        if (!picker) { setCanSaveZip(false); return }
        const controller = new AbortController()
        saveAttempt.current = controller
        const ids = selected.map(entry => entry.asset.id)
        const href = downloadHref
        setFeedback({ kind: "choosing", message: "Choose where to save the ZIP…", ids })
        // The picker must run in this gesture, before any asynchronous module load.
        let picked: Promise<ArchiveFileHandle>
        try { picked = picker.call(window, { suggestedName: "Assets.zip", types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }] }) }
        catch (error) { picked = Promise.reject(error) }
        void (async () => {
            try {
                const file = await picked
                controller.signal.throwIfAborted()
                const { saveAssetArchive } = await import("@/lib/assets/save-archive")
                controller.signal.throwIfAborted()
                const readable = new Set(currentEntries.current.filter(entry => entry.downloadHref).map(entry => entry.asset.id))
                if (ids.some(id => !readable.has(id))) throw new Error("Some files are no longer available. Select files again.")
                await saveAssetArchive({ href, file, signal: controller.signal, onSaving: () => {
                    if (saveAttempt.current === controller) setFeedback({ kind: "saving", message: "Saving ZIP…", ids })
                } })
                if (saveAttempt.current !== controller) return
                setFeedback({ kind: "saved", message: "ZIP saved.", ids })
                // Selection controls remain usable during transfer. Preserve new choices.
                setSelectedIds(current => new Set([...current].filter(id => !ids.includes(id))))
            } catch (error) {
                if (saveAttempt.current !== controller) return
                const cancelled = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")
                const messages = ["Some files are no longer available. Select files again.", "Download up to 500 MB at once, or download large assets individually."]
                const message = cancelled ? "Save cancelled." : error instanceof Error && messages.includes(error.message) ? error.message : "The ZIP could not be saved. Try again, or use Download."
                setFeedback({ kind: cancelled ? "cancelled" : "error", message, ids })
            } finally {
                if (saveAttempt.current === controller) saveAttempt.current = null
            }
        })()
    }
    const currentMenu = menu && previewEntries.some(entry => entry.asset.id === menu.entry.asset.id && entry.downloadHref === menu.entry.downloadHref) ? menu : null

    return <>
        <PanelTabHeader
            title="Assets"
            description="Workspace files and media available for relationship and work-item use."
            actions={<div className="flex w-full flex-wrap items-center justify-end gap-3">
                <button ref={selectRef} type="button" className={quietActionClass} aria-pressed={selecting} onClick={() => { if (selecting) { setSelecting(false); setSelectedIds(new Set()) } else enterSelection(); setMenu(null) }}>{selecting ? "Cancel" : "Select"}</button>
                {selecting ? downloadHref && !busy ? <a href={downloadHref} download target="_blank" rel="noreferrer" className={primaryActionClass} onClick={event => nativeDownload(event, selected)}>Download {selected.length} asset{selected.length === 1 ? "" : "s"}</a> : <button type="button" disabled className={primaryActionClass}>Download {selected.length} asset{selected.length === 1 ? "" : "s"}</button> : <Link href={`/${workspaceSlug}/assets?create=asset`} className={primaryActionClass}>New asset</Link>}
            </div>}
            tabs={<LibraryTabs workspaceSlug={workspaceSlug} active="assets" />}
        />
        <QuickStats ariaLabel="Asset statistics" items={[
            { label: "Total", value: counts.total, hideOnMobile: true },
            { label: "Images", value: counts.images },
            { label: "Documents", value: counts.documents },
            { label: "Uploads", value: counts.uploads },
        ]} />
        {selecting ? <div role="group" aria-label="Asset selection" className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span aria-live="polite" className="text-neutral-400">{selected.length} selected · {formatFileSize(knownBytes)}{unknownSizes ? ` + ${unknownSizes} unknown size${unknownSizes === 1 ? "" : "s"}` : ""}</span>
            <button type="button" className={quietActionClass} disabled={!available.length || selected.length === available.length} onClick={() => { nativeRequested.current = null; setSelectedIds(new Set(available.map(entry => entry.asset.id))) }}>Select all visible</button>
            <button type="button" className={quietActionClass} disabled={!selected.length} onClick={() => setSelectedIds(new Set())}>Clear selection</button>
            {canSaveZip && selected.length > 1 ? <button type="button" className={quietActionClass} disabled={!downloadHref || busy} onClick={saveZip}>Save ZIP as…</button> : null}
            {previewEntries.length > available.length ? <span className="basis-full text-xs text-neutral-500">Assets without a stored file cannot be downloaded.</span> : null}
        </div> : null}
        {archiveTooLarge || tooMany ? <p role="alert" className="mt-5 text-sm text-amber-200">{tooMany ? "Select up to 24 assets at once." : "Download up to 500 MB at once, or download large assets individually."}</p> : null}
        {feedback ? <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <div role={feedback.kind === "error" ? "alert" : "status"}><Status label={feedback.message} wrap tone={feedback.kind === "error" ? "red" : feedback.kind === "saved" ? "green" : busy ? "yellow" : "grey"} /></div>
            {busy ? <button type="button" className={quietActionClass} onClick={() => saveAttempt.current?.abort()}>Cancel save</button> : <>
                {feedback.ids.length > 0 ? <button type="button" className={quietActionClass} onClick={() => selectAgain(feedback.ids)}>Select again</button> : null}
                <button type="button" className={quietActionClass} onClick={() => setFeedback(null)}>Dismiss</button>
            </>}
        </div> : null}
        <section className="mt-5">
            {previewEntries.length ? <AssetGallery label="Assets">{previewEntries.map(entry => {
                const { asset, previewUrl } = entry
                return <AssetGalleryCard key={asset.id} href={`/${workspaceSlug}/assets/${asset.id}`} title={asset.title} subtitle={shortId(asset.id)} previewUrl={previewUrl} format={asset.title.split(".").at(-1)}
                    detail={<span className="flex justify-between gap-2"><span>{formatRelativeTime(asset.updated_at)}</span><span>{formatFileSize(asset.file_size)}</span></span>}
                    navigationPreview={serializeWorkspaceDetailPreview({ category: "Asset", reference: shortId(asset.id), title: asset.title, updated: formatRelativeTime(asset.updated_at) })}
                    selection={selecting ? { checked: Boolean(entry.downloadHref && selectedIds.has(asset.id)), disabled: !entry.downloadHref, onChange: () => toggle(asset.id) } : undefined}
                    onContextMenu={event => {
                        event.preventDefault()
                        nativeRequested.current = null
                        const rect = event.currentTarget.getBoundingClientRect()
                        setMenu({ entry, anchor: event.currentTarget, point: { x: event.clientX - rect.left, y: event.clientY - rect.top } })
                    }}
                    onKeyDown={event => {
                        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
                        event.preventDefault()
                        nativeRequested.current = null
                        setMenu({ entry, anchor: event.currentTarget, point: { x: event.currentTarget.clientWidth / 2, y: 0 } })
                    }}
                />
            })}</AssetGallery> : <div className="rounded-2xl border border-neutral-800 bg-black p-6">
                <p className="text-lg font-semibold">No assets yet.</p>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Upload files from here or attach assets from relationship and work item pages.</p>
            </div>}
        </section>
        {currentMenu ? <AssetContextMenu menu={currentMenu} selected={selectedIds.has(currentMenu.entry.asset.id)} busy={busy} onDownload={event => nativeDownload(event, [currentMenu.entry])} onDismiss={() => setMenu(null)} onSelect={() => {
            const anchor = currentMenu.anchor
            enterSelection()
            toggle(currentMenu.entry.asset.id)
            setMenu(null)
            requestAnimationFrame(() => {
                if (anchor.isConnected) anchor.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus({ preventScroll: true })
            })
        }} /> : null}
    </>
}
