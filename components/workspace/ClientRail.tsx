"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { LoadingPulse } from "@/components/panel/PanelLoading"
import { CLIENT_RAIL_LIMIT, clientInitials, filterRailClients, parseClientRail, type ClientRail as ClientRailData } from "@/lib/client-rail"

const STALE_MS = 5 * 60_000
const SEARCH_FROM = 9

/** A workspace destination the sidebar offers above the clients: Today, Clients, Library, Staff, Settings. */
export type RailDestination = {
    key: string; label: string; href: string; icon: ReactNode; active: boolean
    standalone?: boolean; disabled?: boolean; badge?: ReactNode
}

type RailState = { status: "loading" } | { status: "ready"; rail: ClientRailData; allowed: boolean } | { status: "error"; message: string }

// Last good list per account and workspace, so reopening the phone drawer or remounting does not read it again.
const railMemory = new Map<string, { state: RailState; at: number }>()

// One row shape for destinations and clients: a 20px mark, then the name. 32px from md, a full touch target below.
const rowClass = "relative flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] md:min-h-8 md:text-[13px]"
const idleRow = "text-neutral-400 hover:bg-[var(--color-surface-hover)] hover:text-neutral-100"
const currentRow = "bg-[var(--color-surface-selected)] text-white"
const markClass = "relative flex h-5 w-5 shrink-0 items-center justify-center"

function plainClick(event: MouseEvent) {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function Destination({ item, count, onOpen }: { item: RailDestination; count?: string; onOpen: (item: RailDestination, event: MouseEvent<HTMLAnchorElement>) => void }) {
    return <a href={item.href} data-global-loading="false" data-rail-destination={item.key} title={item.label} aria-current={item.active ? "page" : undefined} aria-disabled={item.disabled || undefined}
        target={item.standalone ? "_blank" : undefined} rel={item.standalone ? "noopener noreferrer" : undefined}
        onClick={event => onOpen(item, event)}
        className={`${rowClass} ${item.active ? currentRow : idleRow} ${item.disabled ? "cursor-not-allowed opacity-40" : ""}`}>
        <span className={markClass}>{item.icon}{item.badge ? <span data-rail-badge className="absolute -right-1.5 -top-1.5">{item.badge}</span> : null}</span>
        <span data-rail-label className="min-w-0 flex-1 truncate">{item.label}</span>
        {count ? <span data-rail-label className="shrink-0 text-xs tabular-nums text-neutral-500">{count}</span> : null}
    </a>
}

/**
 * The Today layout's sidebar: Today and the workspace destinations, then the person's clients by name. From `md` it is a
 * labelled column; the top bar's toggle folds it to a rail of marks that widens over the page on hover (CSS only, see
 * globals.css "Sidebar"). Below `md` it is the slide-in drawer, where the client list takes at most half the screen. It
 * never navigates on its own: every choice goes back to the shell, so resident destinations, departure checks and drafts
 * keep their one owner. Each thing has one way in, so there is no More: Onboarding and Client Connections live on each
 * client's page, and Onboarding Builder and Admin are reached from Settings.
 */
export function ClientRail({ workspaceSlug, userId, activePath, activeClientId, online, today, destinations, refreshKey, phoneBar = false, onOpenClient, onOpenDestination }: {
    workspaceSlug: string; userId: string
    /** Pathname of the destination in front of the person, without a trailing slash. */
    activePath: string
    /** The client the destination in front of the person belongs to (their page, or a record of theirs), if any. */
    activeClientId?: string | null
    online: boolean
    today: RailDestination
    destinations: RailDestination[]
    /** Changes when the shell knows the list changed (a relationship was created). */
    refreshKey: number
    /** The phone bottom bar is present: below `md` it already offers Today and Comms, so the drawer does not repeat them. */
    phoneBar?: boolean
    onOpenClient: (href: string) => void
    onOpenDestination: (item: RailDestination, event: MouseEvent<HTMLAnchorElement>) => void
}) {
    const memoryKey = `${userId}:${workspaceSlug}`
    const [state, setState] = useState<RailState>(() => railMemory.get(memoryKey)?.state ?? { status: "loading" })
    const lastRead = useRef(railMemory.get(memoryKey)?.at ?? 0)
    const load = useCallback(async (signal?: AbortSignal) => {
        const started = Date.now()
        lastRead.current = started
        try {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/client-rail`, {
                cache: "no-store", redirect: "error", credentials: "same-origin", headers: { "x-workspace-user": userId },
                signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
            })
            const value = await response.json() as { allowed?: boolean; error?: string }
            if (signal?.aborted) return
            const rail = response.ok ? parseClientRail(value) : null
            if (!rail) { setState(current => current.status === "ready" ? current : { status: "error", message: value.error ?? "Could not load your clients." }); return }
            const next: RailState = { status: "ready", rail, allowed: value.allowed !== false }
            railMemory.set(memoryKey, { state: next, at: started })
            setState(next)
        } catch (error) {
            // A cancelled read leaves no trace, so the next mount reads again instead of waiting out the stale window.
            if (signal?.aborted) { if (lastRead.current === started) lastRead.current = 0; return }
            setState(current => current.status === "ready" ? current : { status: "error", message: error instanceof Error ? error.message : "Could not load your clients." })
        }
    }, [workspaceSlug, userId, memoryKey])
    useEffect(() => {
        const controller = new AbortController()
        // One read per shell, then a quiet refresh when the window returns after five minutes. No polling.
        const refresh = () => { if (document.visibilityState === "visible" && Date.now() - lastRead.current >= STALE_MS) void load(controller.signal) }
        refresh()
        document.addEventListener("visibilitychange", refresh)
        window.addEventListener("focus", refresh)
        return () => { controller.abort(); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh) }
    }, [load])
    const seenRefreshKey = useRef(refreshKey)
    useEffect(() => {
        if (seenRefreshKey.current === refreshKey) return
        seenRefreshKey.current = refreshKey
        const controller = new AbortController()
        void load(controller.signal)
        return () => controller.abort()
    }, [refreshKey, load])

    const [query, setQuery] = useState("")
    const clients = useMemo(() => state.status === "ready" ? state.rail.clients : [], [state])
    const shown = useMemo(() => filterRailClients(clients, query), [clients, query])
    const relationshipsHref = `/${workspaceSlug}/relationships`
    // The Clients row carries how many clients the person has, from the list this sidebar already read.
    const clientCount = state.status === "ready" && state.allowed && clients.length ? `${clients.length}${state.rail.truncated ? "+" : ""}` : undefined

    return <div data-client-rail-content className="flex flex-col gap-0.5 md:min-h-0 md:flex-1">
        <div className={phoneBar ? "max-md:hidden" : undefined}><Destination item={today} onOpen={onOpenDestination} /></div>
        {destinations.map(item => <div key={item.key} className={phoneBar && item.key === "communications" ? "max-md:hidden" : undefined}>
            <Destination item={item} count={item.key === "relationships" ? clientCount : undefined} onOpen={onOpenDestination} />
        </div>)}

        {state.status === "ready" && !state.allowed ? null : <>
            <p data-rail-section className="mt-3 flex min-h-7 items-center px-2 text-xs text-neutral-500"><span data-rail-label>Your clients</span></p>
            {clients.length >= SEARCH_FROM ? <label data-rail-wide className="block px-0.5 pb-1">
                <span className="sr-only">Find a client</span>
                <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a client" maxLength={80}
                    className="h-11 w-full rounded-md border border-[var(--color-border-default)] bg-transparent px-2.5 text-base text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-600 md:h-8 md:text-[13px]" />
            </label> : null}
            <div role="list" aria-label="Clients" className="-mx-1 flex flex-col gap-0.5 overflow-y-auto overscroll-contain px-1 max-md:max-h-[50dvh] max-md:shrink-0 md:min-h-0 md:flex-1">
                {state.status === "loading" ? <div role="status" aria-label="Loading your clients" className="flex flex-col gap-0.5">
                    {[0, 1, 2, 3].map(row => <div key={row} aria-hidden="true" className="flex min-h-12 items-center px-2 md:min-h-8"><LoadingPulse className="h-5 w-5 rounded-[5px]" /></div>)}
                </div> : null}
                {state.status === "error" ? <p data-rail-wide role="alert" className="px-2 py-2 text-xs leading-5 text-red-200">{state.message} <button type="button" className="underline underline-offset-2" onClick={() => void load()}>Retry</button></p> : null}
                {shown.map(client => {
                    const href = `/${workspaceSlug}/relationships/${client.id}`
                    const current = activePath === href || client.id === activeClientId
                    return <div role="listitem" key={client.id}>
                        <a href={href} data-global-loading="false" data-rail-client title={client.business ? `${client.name}, ${client.business}` : client.name} aria-current={current ? "page" : undefined} aria-disabled={!online || undefined}
                            onClick={event => { if (!plainClick(event)) return; event.preventDefault(); if (online) onOpenClient(href) }}
                            className={`${rowClass} ${current ? currentRow : idleRow} ${online ? "" : "cursor-not-allowed opacity-40"}`}>
                            <span aria-hidden="true" className={`${markClass} rounded-[5px] text-[10px] font-semibold ${current ? "bg-neutral-100 text-neutral-950" : "bg-white/[0.08] text-neutral-300"}`}>{clientInitials(client.name)}</span>
                            <span data-rail-label className="flex min-w-0 flex-1 items-baseline gap-1.5">
                                <span className="truncate">{client.name}</span>
                                {client.business ? <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">{client.business}</span> : null}
                            </span>
                        </a>
                    </div>
                })}
                {state.status === "ready" && clients.length > 0 && shown.length === 0 ? <p data-rail-wide className="px-2 py-2 text-xs text-neutral-400">No client matches.</p> : null}
                {state.status === "ready" && clients.length === 0 ? <p data-rail-wide className="px-2 py-2 text-xs text-neutral-400">No clients yet.</p> : null}
                {state.status === "ready" && state.rail.truncated ? <p data-rail-wide className="px-2 py-2 text-xs leading-5 text-neutral-400">
                    Showing the first {CLIENT_RAIL_LIMIT} by name. <a href={relationshipsHref} data-global-loading="false" className="underline underline-offset-2 hover:text-white"
                        onClick={event => { if (!plainClick(event)) return; event.preventDefault(); onOpenClient(relationshipsHref) }}>All clients</a>
                </p> : null}
            </div>
        </>}
    </div>
}
