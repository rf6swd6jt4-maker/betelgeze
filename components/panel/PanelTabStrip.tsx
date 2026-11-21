import type { ReactNode } from "react"

/** A text tab: the current one is plain white with an underline that sits on the strip's hairline. */
export function panelTabClass(active: boolean, pending = false) {
    return `inline-flex min-h-11 shrink-0 items-center border-b-[1.5px] sm:min-h-9 ${pending ? "border-transparent text-neutral-600" : active ? "border-neutral-100 font-medium text-white" : "border-transparent text-neutral-400 hover:text-neutral-100"}`
}

/** The hairline is an inset shadow, so a tab's underline can sit on it inside a horizontally scrolling strip. */
export const panelTabStripClass = "flex gap-5 overflow-x-auto text-sm shadow-[inset_0_-1px_0_var(--color-card-border)] [scrollbar-width:none]"

export function PanelTabStrip({ ariaLabel, children, decorative = false }: { ariaLabel: string; children: ReactNode; decorative?: boolean }) {
    const className = `mt-5 ${panelTabStripClass}`
    if (decorative) return <div data-panel-tab-strip aria-hidden="true" className={className}>{children}</div>
    return <nav data-panel-tab-strip aria-label={ariaLabel} className={className}>{children}</nav>
}
