"use client"

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import Link from "@/components/workspace/WorkspaceLink"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { AssetGallery, AssetGalleryCard } from "@/components/ui/AssetGallery"
import { AnchoredPopup } from "@/components/ui/AnchoredPopup"
import { LibraryTabs } from "@/components/library/LibraryTabs"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { assetArchiveHref, MAX_ASSET_ARCHIVE_BYTES } from "@/lib/assets/download"
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
    if (!size) return "No file size"
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function AssetContextMenu({ menu, selected, onSelect, onDismiss }: {
    menu: AssetMenu; selected: boolean; onSelect: () => void; onDismiss: () => void
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
            {menu.entry.downloadHref ? <a role="menuitem" className={itemClass} href={menu.entry.downloadHref} download target="_blank" rel="noreferrer" onClick={onDismiss}>Download</a> : <button type="button" role="menuitem" className={itemClass} disabled title="No downloadable file">Download</button>}
        </div>
    </AnchoredPopup>
}

export function AssetLibrary({ workspaceSlug, previewEntries, counts }: {
    workspaceSlug: string
    previewEntries: AssetEntry[]
    counts: { total: number; images: number; documents: number; uploads: number }
}) {
    const active = useWorkspaceNavigation()?.active !== false
    const [previousActive, setPreviousActive] = useState(active)
    const [selecting, setSelecting] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
    const [menu, setMenu] = useState<AssetMenu | null>(null)
    if (active !== previousActive) {
        setPreviousActive(active)
        if (!active) setMenu(null)
    }
    // Use only the current authorized snapshot; removed/unavailable files cannot remain in a download.
    const selected = previewEntries.filter(entry => entry.downloadHref && selectedIds.has(entry.asset.id))
    const archiveTooLarge = selected.length > 1 && selected.reduce((bytes, entry) => bytes + Math.max(0, entry.asset.file_size ?? 0), 0) > MAX_ASSET_ARCHIVE_BYTES
    const downloadHref = archiveTooLarge ? null : selected.length === 1 ? selected[0].downloadHref : selected.length > 1 ? assetArchiveHref(workspaceSlug, selected.map(entry => entry.asset.id)) : null
    function toggle(id: string) {
        setSelectedIds(current => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }
    const currentMenu = menu && previewEntries.some(entry => entry.asset.id === menu.entry.asset.id && entry.downloadHref === menu.entry.downloadHref) ? menu : null

    return <>
        <PanelTabHeader
            title="Assets"
            description="Workspace files and media available for relationship and work-item use."
            actions={<div className="flex w-full items-center justify-end gap-3">
                <button type="button" className="min-h-11 px-2 text-sm text-neutral-300 hover:text-white sm:min-h-10" aria-pressed={selecting} onClick={() => { setSelecting(value => !value); setSelectedIds(new Set()); setMenu(null) }}>{selecting ? "Cancel" : "Select"}</button>
                {selecting ? downloadHref ? <a href={downloadHref} download target="_blank" rel="noreferrer" className={primaryActionClass}>Download {selected.length} asset{selected.length === 1 ? "" : "s"}</a> : <button type="button" disabled className={primaryActionClass}>Download {selected.length} asset{selected.length === 1 ? "" : "s"}</button> : <Link href={`/${workspaceSlug}/assets?create=asset`} className={primaryActionClass}>New asset</Link>}
            </div>}
            tabs={<LibraryTabs workspaceSlug={workspaceSlug} active="assets" />}
        />
        <QuickStats ariaLabel="Asset statistics" items={[
            { label: "Total", value: counts.total, hideOnMobile: true },
            { label: "Images", value: counts.images },
            { label: "Documents", value: counts.documents },
            { label: "Uploads", value: counts.uploads },
        ]} />
        {archiveTooLarge ? <p role="alert" className="mt-5 text-sm text-amber-200">Download up to 500 MB at once, or download large assets individually.</p> : null}
        <section className="mt-5">
            {previewEntries.length ? <AssetGallery label="Assets">{previewEntries.map(entry => {
                const { asset, previewUrl } = entry
                return <AssetGalleryCard key={asset.id} href={`/${workspaceSlug}/assets/${asset.id}`} title={asset.title} subtitle={shortId(asset.id)} previewUrl={previewUrl} format={asset.title.split(".").at(-1)}
                    detail={<span className="flex justify-between gap-2"><span>{formatRelativeTime(asset.updated_at)}</span><span>{formatFileSize(asset.file_size)}</span></span>}
                    navigationPreview={serializeWorkspaceDetailPreview({ category: "Asset", reference: shortId(asset.id), title: asset.title, updated: formatRelativeTime(asset.updated_at) })}
                    selection={selecting ? { checked: Boolean(entry.downloadHref && selectedIds.has(asset.id)), disabled: !entry.downloadHref, onChange: () => toggle(asset.id) } : undefined}
                    onContextMenu={event => {
                        event.preventDefault()
                        const rect = event.currentTarget.getBoundingClientRect()
                        setMenu({ entry, anchor: event.currentTarget, point: { x: event.clientX - rect.left, y: event.clientY - rect.top } })
                    }}
                    onKeyDown={event => {
                        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
                        event.preventDefault()
                        setMenu({ entry, anchor: event.currentTarget, point: { x: event.currentTarget.clientWidth / 2, y: 0 } })
                    }}
                />
            })}</AssetGallery> : <div className="rounded-2xl border border-neutral-800 bg-black p-6">
                <p className="text-lg font-semibold">No assets yet.</p>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Upload files from here or attach assets from relationship and work item pages.</p>
            </div>}
        </section>
        {currentMenu ? <AssetContextMenu menu={currentMenu} selected={selectedIds.has(currentMenu.entry.asset.id)} onDismiss={() => setMenu(null)} onSelect={() => {
            const anchor = currentMenu.anchor
            setSelecting(true)
            toggle(currentMenu.entry.asset.id)
            setMenu(null)
            requestAnimationFrame(() => {
                if (anchor.isConnected) anchor.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus({ preventScroll: true })
            })
        }} /> : null}
    </>
}
