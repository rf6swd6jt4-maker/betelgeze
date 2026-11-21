"use client"

import type { MouseEvent, ReactNode } from "react"
import Link from "@/components/workspace/WorkspaceLink"
import { panelTabClass, panelTabStripClass } from "@/components/panel/PanelTabStrip"
import { Button, RelationshipStage, SquarePill } from "@/components/ui"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { clientInitials } from "@/lib/client-rail"
import type { ClientPageTab, ClientPageTabKey } from "@/lib/client-page"
import { RELATIONSHIP_PHASES, type RelationshipPhase } from "@/lib/relationship-phases"

/**
 * The head of every page that belongs to one client in the Today layout: who they are, where they stand, the one
 * primary action (Chat), and a tab for each thing of theirs. The tabs are ordinary links to existing routes, so the
 * client stays one resident destination and the shell keeps its departure checks. Two tabs that share a route (Overview
 * and Files and notes on the relationship page) switch in place without another read. See docs/ui-standards.md,
 * "Client page".
 */
export function ClientPageHeader({ name, business, phase, isTest = false, tabs, active, onChat, chatHref, actions, onWarm }: {
    /** Called when a tab is pointed at or focused, so a section that reads on its own can start before it is opened. */
    onWarm?: (key: ClientPageTabKey) => void
    name: string; business?: string | null; phase?: string | null; isTest?: boolean
    tabs: readonly ClientPageTab[]; active: ClientPageTabKey
    /** Docks this client's conversation beside the page. Absent where the docked Comms panel is not offered. */
    onChat?: () => void
    /** Used instead of `onChat` where the page cannot ask the shell to dock (a framed page): the conversation's link. */
    chatHref?: string
    actions?: ReactNode
}) {
    const navigation = useWorkspaceNavigation()
    const current = tabs.find(tab => tab.key === active)
    const pathOf = (href: string) => new URL(href, "http://workspace.invalid").pathname
    const switchInPlace = (tab: ClientPageTab) => (event: MouseEvent<HTMLAnchorElement>) => {
        // Same route, different section: change the address through the tab's own owner and keep everything mounted.
        if (!navigation || !current || pathOf(tab.href) !== pathOf(current.href)) return
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        if (tab.key !== active) navigation.push(tab.href)
    }
    const stage = phase && RELATIONSHIP_PHASES.some(entry => entry.key === phase) ? phase as RelationshipPhase : null
    return <header data-client-page-header data-workspace-record-title={name}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3 pb-4">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-[13px] font-semibold text-neutral-200">{clientInitials(name)}</span>
            <div className="min-w-0 flex-1">
                <h1 className="truncate text-xl font-semibold tracking-tight text-white">{name}</h1>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-400">
                    {stage ? <RelationshipStage phase={stage} /> : null}
                    <span className="min-w-0 truncate">{business?.trim() || "No company saved"}</span>
                    {isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}
                </div>
            </div>
            {actions || onChat || chatHref ? <div className="flex shrink-0 items-center gap-2">
                {actions}
                {onChat ? <Button size="sm" data-client-chat onClick={onChat}>Chat</Button> : chatHref ? <Button size="sm" data-client-chat href={chatHref}>Chat</Button> : null}
            </div> : null}
        </div>
        {/* On a phone the strip runs to both screen edges (the page's own 1rem gutter) and uses the short names, so
            five tabs fit a 375px screen, and on a narrower one the last runs off the edge instead of stopping short. */}
        {tabs.length > 1 ? <nav aria-label={`${name} sections`} className={`${panelTabStripClass} max-sm:-mx-4 max-sm:gap-3.5 max-sm:px-4`}>
            {tabs.map(tab => <Link key={tab.key} href={tab.href} prefetch={false} aria-current={tab.key === active ? "page" : undefined} onClick={switchInPlace(tab)}
                onPointerEnter={onWarm && tab.key !== active ? () => onWarm(tab.key) : undefined} onFocus={onWarm && tab.key !== active ? () => onWarm(tab.key) : undefined} className={panelTabClass(tab.key === active)}>
                {tab.shortLabel ? <><span className="sm:hidden">{tab.shortLabel}</span><span className="max-sm:hidden">{tab.label}</span></> : tab.label}
            </Link>)}
        </nav> : <div className="border-b border-card-border" />}
    </header>
}
