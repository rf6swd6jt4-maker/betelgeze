/* eslint-disable @next/next/no-img-element -- Private previews use their authorised URL. */
import Link from "@/components/workspace/WorkspaceLink"
import type { KeyboardEventHandler, MouseEventHandler, ReactNode } from "react"
export function AssetGallery({ children, label }: { children: ReactNode; label: string }) {
    return <div aria-label={label} className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">{children}</div>
}
export function AssetGalleryCard({ title, subtitle, detail, previewUrl, format, href, onClick, navigationPreview, selection, onContextMenu, onKeyDown }: {
    title: string; subtitle?: ReactNode; detail?: ReactNode; previewUrl?: string | null; format?: string
    href?: string; onClick?: () => void; navigationPreview?: string
    selection?: { checked: boolean; disabled?: boolean; disabledReason?: string; onChange: () => void }
    onContextMenu?: MouseEventHandler<HTMLDivElement>
    onKeyDown?: KeyboardEventHandler<HTMLDivElement>
}) {
    const disabledReason = selection?.disabled ? selection.disabledReason || "No downloadable file" : undefined
    const actionClassName = "absolute inset-0 z-10 block h-full w-full rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-neutral-400 disabled:cursor-not-allowed"
    return <div className={`relative h-full min-w-0 w-full overflow-hidden rounded-xl border bg-black text-left ${selection?.checked ? "border-neutral-400" : "border-neutral-800 hover:border-neutral-600"}`} onContextMenu={onContextMenu} onKeyDown={onKeyDown} title={disabledReason}>
        {/* Keep preview ancestors mounted when selection changes; swapping a link for a button reloads private media. */}
        <div>
            <div className="aspect-[4/3] overflow-hidden bg-neutral-900">{previewUrl ? <img src={previewUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-500"><svg aria-hidden="true" viewBox="0 0 32 40" className="h-10 w-8 fill-none stroke-current" strokeWidth="1.5"><path d="M1 1h19l11 11v27H1ZM20 1v12h11M8 22h16M8 28h12" /></svg><span className="text-xs uppercase">{format || "File"}</span></div>}</div>
            <div className="min-w-0 p-3 sm:p-4"><p className="line-clamp-2 break-words text-sm font-medium text-neutral-100">{title}</p>{subtitle ? <div className="mt-1 truncate text-xs text-neutral-500">{subtitle}</div> : null}{detail ? <div className="mt-3 text-xs text-neutral-500">{detail}</div> : null}</div>
        </div>
        {href && !selection ? <Link href={href} prefetch={false} data-workspace-detail-preview={navigationPreview} className={actionClassName} aria-label={title} /> : <button type="button" onClick={selection ? selection.onChange : onClick} disabled={selection?.disabled} className={actionClassName} aria-pressed={selection?.checked} aria-label={selection ? `Select ${title}` : `Preview ${title}`} title={disabledReason} />}
        {selection ? <label className={`absolute right-0 top-0 z-20 flex h-11 w-11 items-center justify-center ${selection.disabled ? "cursor-not-allowed" : "cursor-pointer"}`} title={disabledReason}>
            <input type="checkbox" aria-label={`Select ${title}`} title={disabledReason} checked={selection.checked} disabled={selection.disabled} onChange={selection.onChange} className="h-5 w-5 cursor-pointer rounded border-neutral-500 bg-neutral-950 accent-white shadow-md disabled:cursor-not-allowed disabled:opacity-40" />
        </label> : null}
    </div>
}
export function AddAssetGalleryCard({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
    return <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="relative flex min-w-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-neutral-700 bg-black text-neutral-500 transition before:block before:w-0 before:shrink-0 before:pb-[75%] hover:border-neutral-500 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-400 disabled:cursor-wait disabled:opacity-50">
        <span className="flex flex-col items-center justify-center gap-1.5"><span aria-hidden="true" className="text-3xl font-light">+</span><span className="text-sm">{label}</span></span>
    </button>
}
