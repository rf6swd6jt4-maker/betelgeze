"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react"
import { Button } from "@/components/ui/Button"
import { Status } from "@/components/ui/Status"
import type { ArchiveFileHandle } from "@/lib/assets/save-archive"
import { assetArchiveHref, MAX_ASSET_ARCHIVE_BYTES, MAX_ASSET_DOWNLOADS } from "@/lib/assets/download"

/** What selecting and downloading needs to know about a shown asset. */
export type DownloadEntry = { id: string; fileSize: number | null; downloadHref: string | null }
type Feedback = { kind: "requested" | "choosing" | "saving" | "saved" | "error" | "cancelled"; message: string; ids: string[] }
type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<ArchiveFileHandle>

export const assetDownloadActionClass = "inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--color-accent)] px-4 py-2 text-center text-sm font-medium leading-none text-[var(--color-accent-contrast)] disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-10 sm:px-3"

export function formatFileSize(size: number | null) {
    if (size === null || !Number.isFinite(size) || size < 0) return "Unknown size"
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Selecting shown assets and downloading them: one file through its own link, several as one ZIP. `entries` must keep
 * its identity while the shown assets are unchanged; a new array drops selections that are no longer downloadable.
 */
export function useAssetDownloads(workspaceSlug: string, entries: DownloadEntry[]) {
    const [selecting, setSelecting] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
    const [previousEntries, setPreviousEntries] = useState(entries)
    if (entries !== previousEntries) {
        setPreviousEntries(entries)
        const readable = new Set(entries.filter(entry => entry.downloadHref).map(entry => entry.id))
        setSelectedIds(current => new Set([...current].filter(id => readable.has(id))))
    }
    const [feedback, setFeedback] = useState<Feedback | null>(null)
    const [canSaveZip, setCanSaveZip] = useState(false)
    const selectRef = useRef<HTMLButtonElement | null>(null)
    // Given to the Select toggle, which takes focus back once a download has been requested.
    const bindSelect = useCallback((node: HTMLButtonElement | null) => { selectRef.current = node }, [])
    const nativeRequested = useRef<string | null>(null)
    const saveAttempt = useRef<AbortController | null>(null)
    const currentEntries = useRef(entries)
    useLayoutEffect(() => { currentEntries.current = entries }, [entries])
    useEffect(() => () => { saveAttempt.current?.abort(); saveAttempt.current = null }, [])
    // Selection and recovery use the current authorized cards, never a stored URL.
    const available = entries.filter(entry => entry.downloadHref)
    const selected = available.filter(entry => selectedIds.has(entry.id))
    const knownBytes = selected.reduce((bytes, entry) => bytes + Math.max(0, entry.fileSize ?? 0), 0)
    const unknownSizes = selected.filter(entry => entry.fileSize === null).length
    const archiveTooLarge = selected.length > 1 && knownBytes > MAX_ASSET_ARCHIVE_BYTES
    const tooMany = selected.length > MAX_ASSET_DOWNLOADS
    const busy = feedback?.kind === "choosing" || feedback?.kind === "saving"
    const downloadHref = archiveTooLarge || tooMany ? null : selected.length === 1 ? selected[0].downloadHref : selected.length > 1 ? assetArchiveHref(workspaceSlug, selected.map(entry => entry.id)) : null
    function resetRequest() { nativeRequested.current = null }
    function enterSelection() {
        nativeRequested.current = null
        setSelecting(true)
        setCanSaveZip(typeof (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker === "function")
    }
    function exitSelection() { setSelecting(false); setSelectedIds(new Set()) }
    function toggle(id: string) {
        nativeRequested.current = null
        setSelectedIds(current => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }
    function selectAll() { nativeRequested.current = null; setSelectedIds(new Set(available.map(entry => entry.id))) }
    function clear() { setSelectedIds(new Set()) }
    /** For the click of a native download link. Returns false when the request was a repeat and has been stopped. */
    function nativeDownload(event: MouseEvent<HTMLAnchorElement>, ids: string[]) {
        const requestKey = ids.join(",")
        if (nativeRequested.current === requestKey || saveAttempt.current || !ids.length) { event.preventDefault(); return false }
        nativeRequested.current = requestKey
        setFeedback({ kind: "requested", message: "Download requested. Check your browser’s downloads or Files app.", ids })
        const requestedIds = new Set(ids)
        const remaining = selected.filter(entry => !requestedIds.has(entry.id))
        setSelectedIds(new Set(remaining.map(entry => entry.id)))
        setSelecting(selecting && remaining.length > 0)
        // Keep the native anchor request; no preflight, fetch, blob or extra request.
        requestAnimationFrame(() => { if (selectRef.current?.isConnected) selectRef.current.focus({ preventScroll: true }) })
        return true
    }
    function selectAgain(ids: string[]) {
        const readable = new Set(available.map(entry => entry.id))
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
        const ids = selected.map(entry => entry.id)
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
                const readable = new Set(currentEntries.current.filter(entry => entry.downloadHref).map(entry => entry.id))
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
    return {
        selecting, selectedIds, selected, available, total: entries.length, knownBytes, unknownSizes, archiveTooLarge, tooMany, busy, downloadHref, feedback, canSaveZip, bindSelect,
        resetRequest, enterSelection, exitSelection, toggle, selectAll, clear, nativeDownload, selectAgain, saveZip,
        cancelSave: () => saveAttempt.current?.abort(), dismissFeedback: () => setFeedback(null),
    }
}

type Downloads = ReturnType<typeof useAssetDownloads>

/** The Select / Cancel toggle. */
export function AssetSelectToggle({ downloads, onToggle }: { downloads: Downloads; onToggle?: () => void }) {
    const { bindSelect, selecting, enterSelection, exitSelection } = downloads
    return <Button ref={bindSelect} variant="ghost" size="sm" aria-pressed={selecting} onClick={() => { if (selecting) exitSelection(); else enterSelection(); onToggle?.() }}>{selecting ? "Cancel" : "Select"}</Button>
}

/** The primary action while selecting: one native request for the file, or for the ZIP of several. */
export function AssetDownloadAction({ downloads, onRequested }: { downloads: Downloads; onRequested?: () => void }) {
    const { selected, downloadHref, busy } = downloads
    const label = `Download ${selected.length} asset${selected.length === 1 ? "" : "s"}`
    return downloadHref && !busy
        ? <a href={downloadHref} download target="_blank" rel="noreferrer" className={assetDownloadActionClass} onClick={event => { if (downloads.nativeDownload(event, selected.map(entry => entry.id))) onRequested?.() }}>{label}</a>
        : <Button disabled>{label}</Button>
}

/** The selection summary, its limits and the result of the last download, beneath the header that holds the actions. */
export function AssetSelectionStatus({ downloads, className = "mt-5" }: { downloads: Downloads; className?: string }) {
    const { selecting, selected, available, total, knownBytes, unknownSizes, archiveTooLarge, tooMany, busy, downloadHref, feedback, canSaveZip } = downloads
    return <>
        {selecting ? <div role="group" aria-label="Asset selection" className={`${className} flex flex-wrap items-center gap-x-3 gap-y-1 text-sm`}>
            <span aria-live="polite" className="text-neutral-400">{selected.length} selected · {formatFileSize(knownBytes)}{unknownSizes ? ` + ${unknownSizes} unknown size${unknownSizes === 1 ? "" : "s"}` : ""}</span>
            <Button variant="ghost" size="sm" disabled={!available.length || selected.length === available.length} onClick={downloads.selectAll}>Select all visible</Button>
            <Button variant="ghost" size="sm" disabled={!selected.length} onClick={downloads.clear}>Clear selection</Button>
            {canSaveZip && selected.length > 1 ? <Button variant="ghost" size="sm" disabled={!downloadHref || busy} onClick={downloads.saveZip}>Save ZIP as…</Button> : null}
            {total > available.length ? <span className="basis-full text-xs text-neutral-500">Assets without a stored file cannot be downloaded.</span> : null}
        </div> : null}
        {archiveTooLarge || tooMany ? <p role="alert" className={`${className} text-sm text-amber-200`}>{tooMany ? `Select up to ${MAX_ASSET_DOWNLOADS} assets at once.` : "Download up to 500 MB at once, or download large assets individually."}</p> : null}
        {feedback ? <div className={`${className} flex flex-wrap items-center gap-x-3 gap-y-1`}>
            <div role={feedback.kind === "error" ? "alert" : "status"}><Status label={feedback.message} wrap tone={feedback.kind === "error" ? "red" : feedback.kind === "saved" ? "green" : busy ? "yellow" : "grey"} /></div>
            {busy ? <Button variant="ghost" size="sm" onClick={downloads.cancelSave}>Cancel save</Button> : <>
                {feedback.ids.length > 0 ? <Button variant="ghost" size="sm" onClick={() => downloads.selectAgain(feedback.ids)}>Select again</Button> : null}
                <Button variant="ghost" size="sm" onClick={downloads.dismissFeedback}>Dismiss</Button>
            </>}
        </div> : null}
    </>
}
