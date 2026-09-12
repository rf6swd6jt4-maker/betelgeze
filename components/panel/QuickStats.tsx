import type { ReactNode } from "react"

export type QuickStat = {
    label: string
    value: ReactNode
    hideOnMobile?: boolean
}

export function QuickStats({ items, ariaLabel = "Quick statistics", surface = "dark" }: { items: QuickStat[]; ariaLabel?: string; surface?: "dark" | "light" }) {
    const light = surface === "light"
    return <section aria-label={ariaLabel} className={`mt-5 grid grid-cols-3 overflow-hidden rounded-xl border ${light ? "border-black/10 bg-black/[0.02] text-[var(--onboarding-text,#0F172A)]" : "border-neutral-800 bg-neutral-900"} sm:flex sm:gap-3 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent`}>
        {items.map((item) => <div key={item.label} className={`${item.hideOnMobile ? "hidden sm:block" : ""} min-w-0 border-r ${light ? "border-black/10 sm:border-black/10 sm:bg-black/[0.02]" : "border-neutral-800 sm:border-neutral-800 sm:bg-neutral-900"} px-2 py-2 text-center last:border-r-0 sm:flex-1 sm:rounded-lg sm:border sm:px-3 sm:text-left`}>
            <p className="truncate text-[10px] leading-tight text-neutral-500 sm:text-xs">{item.label}</p>
            <p className="mt-1 truncate text-lg font-semibold tabular-nums">{item.value}</p>
        </div>)}
    </section>
}
