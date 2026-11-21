import type { ReactNode } from "react"

export type QuickStat = {
    label: string
    value: ReactNode
    hideOnMobile?: boolean
}

/**
 * Workspace (dark): plain label-over-value pairs on the canvas, with no boxes. The light client-portal treatment keeps
 * its bordered strip. See docs/ui-standards.md, "QuickStats".
 */
export function QuickStats({ items, ariaLabel = "Quick statistics", surface = "dark" }: { items: QuickStat[]; ariaLabel?: string; surface?: "dark" | "light" }) {
    const light = surface === "light"
    return <section aria-label={ariaLabel} className={light
        ? "mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-black/10 bg-black/[0.02] text-[var(--onboarding-text,#0F172A)] sm:flex sm:gap-3 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent"
        : "mt-5 grid grid-cols-3 gap-x-6 sm:flex sm:gap-x-10"}>
        {items.map((item) => <div key={item.label} className={`${item.hideOnMobile ? "hidden sm:block" : ""} min-w-0 ${light ? "border-r border-black/10 px-2 py-2 text-center last:border-r-0 sm:flex-1 sm:rounded-lg sm:border sm:bg-black/[0.02] sm:px-3 sm:text-left" : ""}`}>
            <p className="truncate text-xs leading-tight text-neutral-500">{item.label}</p>
            <p className={`mt-1 truncate font-semibold tabular-nums ${light ? "text-lg" : "text-base text-neutral-100"}`}>{item.value}</p>
        </div>)}
    </section>
}
