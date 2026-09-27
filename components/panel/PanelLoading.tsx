import type { CSSProperties, ReactNode } from "react"

import { List, ListItem, ListPrimaryRow, ListSecondaryRow } from "@/components/list/List"
import { FilterRail } from "@/components/panel/FilterRail"
import { PanelTabStrip, panelTabClass } from "@/components/panel/PanelTabStrip"
import { QuickStats } from "@/components/panel/QuickStats"
import { AssetGallery } from "@/components/ui/AssetGallery"

export function LoadingPulse({ className = "", style }: { className?: string; style?: CSSProperties }) {
    return <span aria-hidden="true" className={`block rounded bg-neutral-800 motion-safe:animate-pulse ${className}`} style={style} />
}

/** Static tab geometry; access and destination links are unknown while a route is pending. */
export function PanelLoadingTabs({ count = 4, active = 0 }: { count?: number; active?: number }) {
    return <PanelTabStrip ariaLabel="Loading panel sections" decorative>
        {Array.from({ length: count }, (_, index) => <span key={index} aria-hidden="true" className={panelTabClass(index === active)}>
            <LoadingPulse className={`h-5 ${index === active ? "w-16 bg-neutral-500" : "w-14 bg-neutral-700"}`} />
        </span>)}
    </PanelTabStrip>
}

export function PanelLoadingStats({ labels, hideOnMobileIndex }: { labels: readonly string[]; hideOnMobileIndex?: number }) {
    return <QuickStats ariaLabel="Loading statistics" items={labels.map((label, index) => ({
        label,
        value: <LoadingPulse className="h-7 w-10" />,
        hideOnMobile: index === hideOnMobileIndex,
    }))} />
}

export function PanelLoadingFilters({ widths, tight = false }: { widths: readonly number[]; tight?: boolean }) {
    return <FilterRail ariaLabel="Loading filters" spacing={tight ? "tight" : "default"}>
        {widths.map((width, index) => <span key={index} aria-hidden="true" className="shrink-0 border-b border-transparent px-2 py-2 text-sm">
            <LoadingPulse className="h-5" style={{ width }} />
        </span>)}
    </FilterRail>
}

export function PanelLoadingSecondary({ onboarding = false }: { onboarding?: boolean }) {
    return <ListSecondaryRow className={onboarding ? "min-h-[49px]" : ""}>
        <LoadingPulse className="h-5 w-24" />
        <LoadingPulse className="hidden h-5 w-36 sm:block" />
        <LoadingPulse className="ml-auto h-5 w-20" />
    </ListSecondaryRow>
}

export function PanelLoadingRow({ kind = "default" }: { kind?: "default" | "relationship" | "onboarding" }) {
    // These five placeholder rows must paint immediately; real record lists keep
    // their content-visibility optimization for growing datasets.
    return <ListItem className="[content-visibility:visible]">
        <ListPrimaryRow>
            <LoadingPulse className="h-6 w-48 max-w-[45vw]" />
            {kind === "relationship" ? <LoadingPulse className="h-6 w-20" /> : null}
            {kind === "onboarding" ? <LoadingPulse className="hidden h-2 w-24 sm:block" /> : null}
            <LoadingPulse className="ml-auto h-4 w-20" />
        </ListPrimaryRow>
        <PanelLoadingSecondary onboarding={kind === "onboarding"} />
    </ListItem>
}

export function PanelLoadingList({ kind = "default", rows = 5, label = "Loading content" }: { kind?: "default" | "relationship" | "onboarding"; rows?: number; label?: string }) {
    return <List ariaLabel={label}>{Array.from({ length: rows }, (_, index) => <PanelLoadingRow key={index} kind={kind} />)}</List>
}

export function PanelLoadingGallery({ count = 5 }: { count?: number }) {
    return <section className="mt-5" aria-label="Loading assets">
        <AssetGallery label="Loading assets">{Array.from({ length: count }, (_, index) => <div key={index} className="min-w-0 overflow-hidden rounded-xl border border-neutral-800 bg-black">
            <LoadingPulse className="aspect-[4/3] w-full rounded-none bg-neutral-900" />
            <div className="p-3 sm:p-4"><LoadingPulse className="h-4 w-4/5" /><LoadingPulse className="mt-2 h-3 w-16" /><LoadingPulse className="mt-3 h-3 w-2/3" /></div>
        </div>)}</AssetGallery>
    </section>
}

export function OnboardingLoadingRow() {
    return <PanelLoadingRow kind="onboarding" />
}

export function OnboardingLoadingSecondary() {
    return <PanelLoadingSecondary onboarding />
}

export function OnboardingPanelLoading() {
    return <div aria-label="Loading onboarding" aria-busy="true">
        <PanelLoadingStats labels={["Active", "Complete", "Stuck"]} />
        <PanelLoadingFilters widths={[70, 84, 96, 78, 72]} />
        <PanelLoadingList kind="onboarding" rows={5} label="Loading onboarding" />
    </div>
}

export function ActivityTrendsLoading() {
    return <section aria-label="Loading activity trends" aria-busy="true">
        <PanelLoadingFilters widths={[62, 62, 62, 62]} />
        <div className="mt-5 grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="aspect-[2/1] rounded-xl border border-neutral-800 bg-neutral-900 motion-safe:animate-pulse" />)}</div>
    </section>
}

export function PanelLoadingFrame({ title, children }: { title: string; children: ReactNode }) {
    return <main data-workspace-loading-root aria-label={`Loading ${title}`} aria-busy="true" className="min-h-screen max-w-full overflow-x-clip bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <div className="mx-auto max-w-7xl">{children}</div>
    </main>
}
