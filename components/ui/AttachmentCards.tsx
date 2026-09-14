import type { ReactNode } from "react"

/** An attached-item gallery, deliberately distinct from the navigable record List. */
export function AttachmentCards({ children, label, selection = false, compact = false }: { children: ReactNode; label: string; selection?: boolean; compact?: boolean }) {
    return <div aria-label={label} className={`grid min-w-0 items-start ${compact ? "gap-2" : "gap-3"} ${selection ? "grid-cols-1 sm:grid-cols-2" : compact ? "grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]" : "grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]"}`}>{children}</div>
}
export function AttachmentCard({ title, thumbnail, subtitle, inactive, broken, selected, onClick, disabled, children, compact = false, thumbnailFit = "cover" }: {
    title: string; thumbnail: ReactNode; subtitle?: ReactNode; inactive?: boolean; broken?: boolean; selected?: boolean; onClick?: () => void; disabled?: boolean; children?: ReactNode; compact?: boolean; thumbnailFit?: "cover" | "contain"
}) {
    return <div className={`${children ? "" : compact ? "aspect-[4/3]" : "aspect-square"} min-w-0 overflow-hidden rounded-xl border ${broken ? "border-red-900 bg-red-950/20" : selected ? "border-neutral-300 bg-neutral-900" : "border-neutral-800 bg-neutral-900/50"}`}>
        <button type="button" onClick={onClick} disabled={disabled} aria-pressed={selected} title={title} className={`flex ${children ? "" : "h-full"} w-full min-w-0 flex-col items-start overflow-hidden text-left disabled:cursor-not-allowed ${compact ? "gap-1.5 p-2.5" : "gap-1.5 p-2.5 sm:gap-2 sm:p-3"} ${inactive ? "text-neutral-500" : "text-neutral-200"}`}>
            <span aria-hidden="true" className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-800 text-2xl [&_img]:h-full [&_img]:w-full ${compact ? "h-11 w-11 sm:h-12 sm:w-12" : "h-9 w-9 sm:h-12 sm:w-12"} ${thumbnailFit === "contain" ? "[&_img]:object-contain [&_img]:object-center" : "[&_img]:object-cover"} ${inactive ? "grayscale opacity-50" : ""}`}>{thumbnail}</span>
            <span className={`line-clamp-2 w-full shrink-0 break-words font-semibold ${compact ? "text-base leading-5" : "text-sm leading-[18px] sm:leading-5"}`}>{title}</span>
            {subtitle ? <span className="w-full shrink-0 truncate text-xs text-neutral-500">{subtitle}</span> : null}
        </button>
        {children ? <div className="border-t border-neutral-800 p-3">{children}</div> : null}
    </div>
}
export function AddAttachmentCard({ label, onClick, compact = false }: { label: string; onClick: () => void; compact?: boolean }) {
    return <button type="button" onClick={onClick} aria-label={label} className={`flex w-full min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-white ${compact ? "aspect-[4/3]" : "aspect-square"}`}><span aria-hidden="true" className="text-3xl font-light">+</span><span className={compact ? "text-sm" : "text-xs"}>{label}</span></button>
}
