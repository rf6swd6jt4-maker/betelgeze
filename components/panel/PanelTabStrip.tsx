import type { ReactNode } from "react"

export function panelTabClass(active: boolean, pending = false) {
    return `shrink-0 rounded-lg px-3 py-2.5 sm:py-2 ${pending ? active ? "bg-neutral-900 text-neutral-500" : "border border-neutral-800 text-neutral-500" : active ? "bg-white font-medium text-black" : "border border-neutral-800 text-neutral-300 hover:border-neutral-600 hover:text-white"}`
}

export function PanelTabStrip({ ariaLabel, children, decorative = false }: { ariaLabel: string; children: ReactNode; decorative?: boolean }) {
    const className = "mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    if (decorative) return <div data-panel-tab-strip aria-hidden="true" className={className}>{children}</div>
    return <nav data-panel-tab-strip aria-label={ariaLabel} className={className}>{children}</nav>
}
