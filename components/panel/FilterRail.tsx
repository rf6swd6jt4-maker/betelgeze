"use client"

import Link from "@/components/workspace/WorkspaceLink"
import type { ButtonHTMLAttributes, ReactNode } from "react"
import { usePathname, useSearchParams, useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"

export type InstantFilterTarget = {
    param: string
    value: string | null
    defaultValue?: string | null
}

// Workspace (dark): a quiet chip, washed when selected, so a filter never reads as a tab (tabs are underlined).
// Light client-facing rails keep their underline; their classes are spelled out as overrides because a light rail
// can be any element carrying `group/rail` and `data-surface="light"`, not only <FilterRail>.
/** A chip's box, shared with the loading placeholder (PanelLoadingFilters) so content never shifts when a page arrives. */
export const filterRailItemBox = "inline-flex shrink-0 items-center rounded-md px-2.5 py-1 text-[13px] leading-5"

function itemClass(selected: boolean) {
    const light = "group-data-[surface=light]/rail:min-h-11 group-data-[surface=light]/rail:rounded-none group-data-[surface=light]/rail:border-b group-data-[surface=light]/rail:px-3 group-data-[surface=light]/rail:py-2 group-data-[surface=light]/rail:text-sm group-data-[surface=light]/rail:focus-visible:outline-2 group-data-[surface=light]/rail:focus-visible:outline-offset-[-2px]"
    return `${filterRailItemBox} transition-colors ${light} ${selected
        ? "bg-[var(--color-surface-selected)] text-white group-data-[surface=light]/rail:border-[var(--onboarding-primary,#1E3A5F)] group-data-[surface=light]/rail:bg-transparent group-data-[surface=light]/rail:font-semibold group-data-[surface=light]/rail:text-[var(--onboarding-primary,#1E3A5F)]"
        : "text-neutral-400 hover:bg-[var(--color-surface-hover)] hover:text-neutral-100 group-data-[surface=light]/rail:border-transparent group-data-[surface=light]/rail:text-[var(--onboarding-muted,#475569)] group-data-[surface=light]/rail:hover:border-black/20 group-data-[surface=light]/rail:hover:bg-transparent group-data-[surface=light]/rail:hover:text-[var(--onboarding-text,#0F172A)]"}`
}

export function FilterRail({ ariaLabel, children, spacing = "default", surface = "dark" }: { ariaLabel: string; children: ReactNode; spacing?: "default" | "tight"; surface?: "dark" | "light" }) {
    return <section data-surface={surface} className={`group/rail ${spacing === "tight" ? "mt-2" : "mt-5"} ${surface === "light" ? "border-b border-black/10" : ""}`}>
        <nav aria-label={ariaLabel} className={`flex gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] ${surface === "light" ? "px-1 pb-1" : ""}`}>
            {children}
        </nav>
    </section>
}

export function FilterRailLink({ href, selected, instant, children }: { href: string; selected: boolean; instant?: InstantFilterTarget | false; children: ReactNode }) {
    const navigation = useWorkspaceNavigation()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const currentValue = instant ? searchParams.get(instant.param) ?? instant.defaultValue ?? null : null
    const currentSelected = instant ? currentValue === instant.value : selected
    const instantParams = instant ? new URLSearchParams(searchParams.toString()) : null
    if (instant && instantParams) {
        if (instant.value === null) instantParams.delete(instant.param)
        else instantParams.set(instant.param, instant.value)
    }
    const instantQuery = instantParams?.toString()
    const navigationHref = instant ? `${pathname}${instantQuery ? `?${instantQuery}` : ""}` : href

    return <Link
        href={navigationHref}
        prefetch={instant ? false : undefined}
        data-workspace-instant-filter={instant ? "" : undefined}
        aria-current={currentSelected ? "page" : undefined}
        className={itemClass(currentSelected)}
        onClick={instant ? (event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            const nextUrl = navigationHref
            if (navigation) { navigation.push(nextUrl); return }
            if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl)
        } : undefined}
    >{children}</Link>
}

export function FilterRailButton({ selected, children, ...props }: { selected: boolean; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
    return <button type="button" aria-pressed={selected} className={itemClass(selected)} {...props}>{children}</button>
}

export function FilterRailCount({ children }: { children: ReactNode }) {
    return <span className="ml-1 tabular-nums text-neutral-500">{children}</span>
}
