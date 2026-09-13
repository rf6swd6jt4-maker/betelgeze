import Link from "next/link"
import type { ReactNode } from "react"

/** Document galleries use square covers rather than the operational List rows. */
export function DocumentCatalogue({ children, label }: { children: ReactNode; label: string }) {
    return <div role="list" aria-label={label} className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">{children}</div>
}
const cardClass = "relative flex aspect-square min-h-0 min-w-0 w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-center text-white transition hover:border-neutral-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:p-4"
export function DocumentCard({ href, title, format, detail }: { href: string; title: string; format: string; detail: string }) {
    return <div role="listitem" className="min-w-0"><Link href={href} prefetch={false} className={cardClass}>
        <svg viewBox="0 0 32 40" aria-hidden="true" className="mb-1 h-7 w-6 shrink-0 sm:mb-2 sm:h-10 sm:w-8 fill-none stroke-neutral-500" strokeWidth="1.5"><path d="M5 1h15l11 11v27H1V1h4ZM20 1v12h11M8 22h16M8 28h12" /></svg>
        <span className="mb-1 text-[10px] sm:mb-2 font-medium uppercase tracking-wider text-neutral-400">{format}</span>
        <span className="line-clamp-2 w-full break-words text-sm font-medium leading-5" title={title}>{title}</span>
        <span className="mt-1 text-xs text-neutral-500">{detail}</span>
    </Link></div>
}
export function AddDocumentCard({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
    return <div role="listitem" className="min-w-0"><button type="button" onClick={onClick} disabled={disabled} className={`${cardClass} border-dashed disabled:cursor-wait disabled:opacity-50`}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="mb-3 h-7 w-7 fill-none stroke-neutral-400" strokeWidth="1.5"><path d="M12 4v16M4 12h16" /></svg>
        <span className="text-sm font-medium">{label}</span>
    </button></div>
}
