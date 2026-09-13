import type { ReactNode } from "react"

/** An attached-item gallery, deliberately distinct from the navigable record List. */
export function AttachmentCards({ children, label, selection = false }: { children: ReactNode; label: string; selection?: boolean }) {
    return <div aria-label={label} className={`grid min-w-0 items-start gap-3 ${selection ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]"}`}>{children}</div>
}
export function AttachmentCard({ title, thumbnail, subtitle, inactive, broken, selected, onClick, disabled, children }: {
    title: string; thumbnail: ReactNode; subtitle?: ReactNode; inactive?: boolean; broken?: boolean; selected?: boolean; onClick?: () => void; disabled?: boolean; children?: ReactNode
}) {
    return <div className={`min-w-0 overflow-hidden rounded-xl border ${broken ? "border-red-900 bg-red-950/20" : selected ? "border-neutral-300 bg-neutral-900" : "border-neutral-800 bg-neutral-900/50"}`}>
        <button type="button" onClick={onClick} disabled={disabled} aria-pressed={selected} className={`flex w-full min-w-0 flex-col items-start gap-2 p-3 text-left disabled:cursor-not-allowed ${inactive ? "text-neutral-500" : "text-neutral-200"}`}>
            <span aria-hidden="true" className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-800 text-2xl [&_img]:h-full [&_img]:w-full [&_img]:object-cover ${inactive ? "grayscale opacity-50" : ""}`}>{thumbnail}</span>
            <span className="w-full break-words text-sm font-semibold leading-5">{title}</span>
            {subtitle ? <span className="w-full truncate text-xs text-neutral-500">{subtitle}</span> : null}
        </button>
        {children ? <div className="border-t border-neutral-800 p-3">{children}</div> : null}
    </div>
}
export function AddAttachmentCard({ label, onClick }: { label: string; onClick: () => void }) {
    return <button type="button" onClick={onClick} aria-label={label} className="flex min-h-32 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-white"><span aria-hidden="true" className="text-3xl font-light">+</span><span className="text-xs">{label}</span></button>
}
