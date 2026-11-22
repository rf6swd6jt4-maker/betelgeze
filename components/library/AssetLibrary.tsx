"use client"

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { AssetGallery, AssetGalleryCard } from "@/components/ui/AssetGallery"
import { AnchoredPopup } from "@/components/ui/AnchoredPopup"
import { Button } from "@/components/ui/Button"
import { LibraryTabs } from "@/components/library/LibraryTabs"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { AssetDownloadAction, AssetSelectionStatus, AssetSelectToggle, formatFileSize, useAssetDownloads } from "@/components/library/useAssetDownloads"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { serializeWorkspaceDetailPreview } from "@/lib/workspace-detail-preview"

export type AssetEntry = {
    asset: { id: string; title: string; content_type: string | null; file_size: number | null; updated_at: string }
    previewUrl: string | null
    downloadHref: string | null
}
type AssetPage = { entries: AssetEntry[]; nextCursor: string | null }
// Older pages already added stay with the account and workspace while the Library is away (opening an asset and coming
// back), for less time than their private preview links last. A few workspaces at most.
const OLDER_RETENTION_MS = 30 * 60_000
const retainedOlder = new Map<string, { page: AssetPage; at: number }>()
function readRetainedOlder(key: string) {
    const entry = retainedOlder.get(key)
    if (entry && Date.now() - entry.at < OLDER_RETENTION_MS) return entry.page
    retainedOlder.delete(key)
    return null
}
type AssetMenu = { entry: AssetEntry; anchor: HTMLElement; point: { x: number; y: number } }

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
    const itemClass = "flex min-h-11 w-full items-center px-3 py-2 text-left text-sm text-neutral-200 hover:bg-[var(--color-surface-hover)] focus-visible:bg-neutral-900 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    return <AnchoredPopup anchor={menu.anchor} anchorPoint={menu.point} onDismiss={onDismiss} className="w-44 rounded-lg border border-card-border shadow-popup">
        <div ref={menuRef} role="menu" aria-label={`Actions for ${menu.entry.asset.title}`} onKeyDown={onKeyDown}>
            <button type="button" role="menuitem" className={itemClass} disabled={!menu.entry.downloadHref} onClick={onSelect}>{selected ? "Deselect" : "Select"}</button>
            {menu.entry.downloadHref && !busy ? <a role="menuitem" className={itemClass} href={menu.entry.downloadHref} download target="_blank" rel="noreferrer" onClick={onDownload}>Download</a> : <button type="button" role="menuitem" className={itemClass} disabled title={busy ? "A ZIP save is in progress" : "No downloadable file"}>Download</button>}
        </div>
    </AnchoredPopup>
}

export function AssetLibrary({ workspaceSlug, userId, previewEntries, nextCursor, counts }: {
    workspaceSlug: string
    userId: string
    previewEntries: AssetEntry[]
    /** Where the assets after `previewEntries` start; null when there are none. */
    nextCursor: string | null
    counts: { total: number; images: number; documents: number; uploads: number }
}) {
    const active = useWorkspaceNavigation()?.active !== false
    const [previousActive, setPreviousActive] = useState(active)
    // Older assets are read one page at a time, only when asked for. A refreshed first page keeps them in place.
    const olderKey = `${userId}:${workspaceSlug}`
    const [older, setOlder] = useState<AssetPage | null>(() => readRetainedOlder(olderKey))
    useEffect(() => {
        if (!older) return
        retainedOlder.delete(olderKey); retainedOlder.set(olderKey, { page: older, at: Date.now() })
        while (retainedOlder.size > 4) retainedOlder.delete(retainedOlder.keys().next().value!)
    }, [older, olderKey])
    const [loadingOlder, setLoadingOlder] = useState(false)
    const [olderError, setOlderError] = useState<string | null>(null)
    const olderRequest = useRef<AbortController | null>(null)
    useEffect(() => () => { olderRequest.current?.abort(); olderRequest.current = null }, [])
    const entries = useMemo(() => {
        if (!older) return previewEntries
        const first = new Set(previewEntries.map(entry => entry.asset.id))
        return [...previewEntries, ...older.entries.filter(entry => !first.has(entry.asset.id))]
    }, [previewEntries, older])
    const cursor = older ? older.nextCursor : nextCursor
    const downloadEntries = useMemo(() => entries.map(entry => ({ id: entry.asset.id, fileSize: entry.asset.file_size, downloadHref: entry.downloadHref })), [entries])
    const downloads = useAssetDownloads(workspaceSlug, downloadEntries)
    const { selecting, selectedIds, busy } = downloads
    const [menu, setMenu] = useState<AssetMenu | null>(null)
    if (active !== previousActive) {
        setPreviousActive(active)
        if (!active) setMenu(null)
    }
    async function loadOlder() {
        if (olderRequest.current || !cursor) return
        const controller = new AbortController()
        olderRequest.current = controller
        // One bounded read per press; a failure waits for the person to retry.
        const timeout = setTimeout(() => controller.abort(), 30_000)
        setLoadingOlder(true); setOlderError(null)
        try {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/assets?cursor=${encodeURIComponent(cursor)}`, { signal: controller.signal, cache: "no-store", redirect: "error", headers: { "x-workspace-user": userId } })
            if (!response.ok) throw new Error()
            const page = await response.json() as AssetPage
            if (olderRequest.current !== controller) return
            setOlder(current => {
                const known = new Set(current?.entries.map(entry => entry.asset.id))
                return { entries: [...(current?.entries ?? []), ...page.entries.filter(entry => !known.has(entry.asset.id))], nextCursor: page.nextCursor }
            })
        } catch {
            if (olderRequest.current === controller) setOlderError("Older assets could not load.")
        } finally {
            clearTimeout(timeout)
            if (olderRequest.current === controller) { olderRequest.current = null; setLoadingOlder(false) }
        }
    }
    const currentMenu = menu && entries.some(entry => entry.asset.id === menu.entry.asset.id && entry.downloadHref === menu.entry.downloadHref) ? menu : null

    return <>
        <PanelTabHeader
            title="Assets"
            description="Workspace files and media available for relationship and work-item use."
            actions={<div className="flex w-full flex-wrap items-center justify-end gap-3">
                <AssetSelectToggle downloads={downloads} onToggle={() => setMenu(null)} />
                {selecting ? <AssetDownloadAction downloads={downloads} onRequested={() => setMenu(null)} /> : <Button href={`/${workspaceSlug}/assets?create=asset`}>New asset</Button>}
            </div>}
            tabs={<LibraryTabs workspaceSlug={workspaceSlug} active="assets" />}
        />
        <QuickStats ariaLabel="Asset statistics" items={[
            { label: "Total", value: counts.total, hideOnMobile: true },
            { label: "Images", value: counts.images },
            { label: "Documents", value: counts.documents },
            { label: "Uploads", value: counts.uploads },
        ]} />
        <AssetSelectionStatus downloads={downloads} />
        <section className="mt-5">
            {entries.length ? <AssetGallery label="Assets">{entries.map(entry => {
                const { asset, previewUrl } = entry
                return <AssetGalleryCard key={asset.id} href={`/${workspaceSlug}/assets/${asset.id}`} title={asset.title} subtitle={shortId(asset.id)} previewUrl={previewUrl} format={asset.title.split(".").at(-1)}
                    detail={<span className="flex justify-between gap-2"><span>{formatRelativeTime(asset.updated_at)}</span><span>{formatFileSize(asset.file_size)}</span></span>}
                    navigationPreview={serializeWorkspaceDetailPreview({ category: "Asset", reference: shortId(asset.id), title: asset.title, updated: formatRelativeTime(asset.updated_at) })}
                    selection={selecting ? { checked: Boolean(entry.downloadHref && selectedIds.has(asset.id)), disabled: !entry.downloadHref, onChange: () => downloads.toggle(asset.id) } : undefined}
                    onContextMenu={event => {
                        event.preventDefault()
                        downloads.resetRequest()
                        const rect = event.currentTarget.getBoundingClientRect()
                        setMenu({ entry, anchor: event.currentTarget, point: { x: event.clientX - rect.left, y: event.clientY - rect.top } })
                    }}
                    onKeyDown={event => {
                        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
                        event.preventDefault()
                        downloads.resetRequest()
                        setMenu({ entry, anchor: event.currentTarget, point: { x: event.currentTarget.clientWidth / 2, y: 0 } })
                    }}
                />
            })}</AssetGallery> : <div className="rounded-2xl border border-card-border p-6">
                <p className="text-lg font-semibold">No assets yet.</p>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Upload files from here or attach assets from relationship and work item pages.</p>
            </div>}
            {cursor || olderError ? <div className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                {olderError ? <p role="alert" className="text-sm text-red-200">{olderError}</p> : null}
                {cursor ? <Button variant="secondary" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "Loading…" : olderError ? "Retry" : "Load more"}</Button> : null}
            </div> : null}
        </section>
        {currentMenu ? <AssetContextMenu menu={currentMenu} selected={selectedIds.has(currentMenu.entry.asset.id)} busy={busy} onDownload={event => { if (downloads.nativeDownload(event, [currentMenu.entry.asset.id])) setMenu(null) }} onDismiss={() => setMenu(null)} onSelect={() => {
            const anchor = currentMenu.anchor
            downloads.enterSelection()
            downloads.toggle(currentMenu.entry.asset.id)
            setMenu(null)
            requestAnimationFrame(() => {
                if (anchor.isConnected) anchor.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus({ preventScroll: true })
            })
        }} /> : null}
    </>
}
