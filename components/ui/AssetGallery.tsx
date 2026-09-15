/* eslint-disable @next/next/no-img-element -- Private previews use their authorised URL. */
import Link from "@/components/workspace/WorkspaceLink"
import type { ReactNode } from "react"
export function AssetGallery({ children, label }: { children: ReactNode; label: string }) {
    return <div aria-label={label} className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">{children}</div>
}
export function AssetGalleryCard({ title, subtitle, detail, previewUrl, format, href, onClick, navigationPreview }: { title: string; subtitle?: ReactNode; detail?: ReactNode; previewUrl?: string | null; format?: string; href?: string; onClick?: () => void; navigationPreview?: string }) {
    const content = <><div className="aspect-[4/3] overflow-hidden bg-neutral-900">{previewUrl ? <img src={previewUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-500"><svg aria-hidden="true" viewBox="0 0 32 40" className="h-10 w-8 fill-none stroke-current" strokeWidth="1.5"><path d="M1 1h19l11 11v27H1ZM20 1v12h11M8 22h16M8 28h12" /></svg><span className="text-xs uppercase">{format || "File"}</span></div>}</div><div className="min-w-0 p-3 sm:p-4"><p className="line-clamp-2 break-words text-sm font-medium text-neutral-100">{title}</p>{subtitle ? <div className="mt-1 truncate text-xs text-neutral-500">{subtitle}</div> : null}{detail ? <div className="mt-3 text-xs text-neutral-500">{detail}</div> : null}</div></>
    const className = "block min-w-0 w-full overflow-hidden rounded-xl border border-neutral-800 bg-black text-left hover:border-neutral-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-400"
    return href ? <Link href={href} prefetch={false} data-workspace-detail-preview={navigationPreview} className={className}>{content}</Link> : <button type="button" onClick={onClick} className={className} aria-label={`Preview ${title}`}>{content}</button>
}
export function AddAssetGalleryCard({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
    return <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="relative flex min-w-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-neutral-700 bg-black text-neutral-500 transition before:block before:w-0 before:shrink-0 before:pb-[75%] hover:border-neutral-500 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-400 disabled:cursor-wait disabled:opacity-50">
        <span className="flex flex-col items-center justify-center gap-1.5"><span aria-hidden="true" className="text-3xl font-light">+</span><span className="text-sm">{label}</span></span>
    </button>
}
