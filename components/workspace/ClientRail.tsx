"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { LoadingPulse } from "@/components/panel/PanelLoading"
import { CLIENT_RAIL_LIMIT, clientInitials, filterRailClients, parseClientRail, type ClientRail as ClientRailData } from "@/lib/client-rail"

const STALE_MS = 5 * 60_000
const SEARCH_FROM = 9

/** A workspace destination the rail offers below the clients. `primary` ones always show; the rest sit behind More. */
export type RailDestination = {
    key: string; label: string; href: string; icon: ReactNode; active: boolean; primary: boolean
    standalone?: boolean; disabled?: boolean; badge?: ReactNode
}

type RailState = { status: "loading" } | { status: "ready"; rail: ClientRailData; allowed: boolean } | { status: "error"; message: string }

// Last good list per account and workspace, so reopening the phone drawer or remounting does not read it again.
const railMemory = new Map<string, { state: RailState; at: number }>()

const rowClass = "relative flex min-h-12 w-full min-w-0 items-center gap-3 rounded-lg px-1 text-left text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-500 md:min-h-11 md:text-sm"
const idleRow = "text-neutral-300 hover:bg-[var(--color-surface-hover)] hover:text-white"
const currentRow = "bg-white/[0.06] text-white"
const tileClass = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full"

function plainClick(event: MouseEvent) {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function MoreIcon() {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current md:h-4 md:w-4"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
}

function Destination({ item, onOpen }: { item: RailDestination; onOpen: (item: RailDestination, event: MouseEvent<HTMLAnchorElement>) => void }) {
    return <a href={item.href} data-global-loading="false" aria-current={item.active ? "page" : undefined} aria-disabled={item.disabled || undefined}
        target={item.standalone ? "_blank" : undefined} rel={item.standalone ? "noopener noreferrer" : undefined}
        onClick={event => onOpen(item, event)}
        className={`${rowClass} ${item.active ? currentRow : idleRow} ${item.disabled ? "cursor-not-allowed opacity-40" : ""}`}>
        <span className={`${tileClass} relative`}>{item.icon}{item.badge ? <span data-rail-badge className="absolute right-0 top-0">{item.badge}</span> : null}</span>
        <span data-rail-label className="min-w-0 flex-1 truncate">{item.label}</span>
    </a>
}

/**
 * The Today layout's navigation: Today, then the person's clients as initials, then the other destinations. From `md`
 * it is a narrow rail that widens over the page on hover (CSS only, see globals.css "Client rail") or stays wide when
 * pinned; below `md` it is the slide-in drawer with names, where the client list takes at most half the screen so the
 * destinations below stay within reach. It never navigates on its own: every choice goes back to
 * the shell, so resident destinations, departure checks and drafts keep their one owner.
 */
export function ClientRail({ workspaceSlug, userId, activePath, activeClientId, online, today, destinations, refreshKey, onOpenClient, onOpenDestination }: {
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
    const [moreOpen, setMoreOpen] = useState(false)
    const clients = useMemo(() => state.status === "ready" ? state.rail.clients : [], [state])
    const shown = useMemo(() => filterRailClients(clients, query), [clients, query])
    const primary = destinations.filter(item => item.primary)
    const secondary = destinations.filter(item => !item.primary)
    // The rail never rearranges itself: More opens and closes only when the person presses it. A destination behind a
    // closed More marks the More row instead.
    const moreShown = moreOpen
    const hiddenCurrent = !moreOpen && secondary.some(item => item.active)
    const relationshipsHref = `/${workspaceSlug}/relationships`

    return <div data-client-rail-content className="flex flex-col gap-1 md:min-h-0 md:flex-1">
        <Destination item={today} onOpen={onOpenDestination} />

        {state.status === "ready" && !state.allowed ? <div className="md:min-h-0 md:flex-1" /> : <>
            {clients.length >= SEARCH_FROM ? <label data-rail-wide className="block px-1 pt-1">
                <span className="sr-only">Find a client</span>
                <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a client" maxLength={80}
                    className="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-base text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-600 focus:ring-2 focus:ring-white/10 md:h-9 md:text-sm" />
            </label> : null}
            <div role="list" aria-label="Clients" className="-mx-1 overflow-y-auto overscroll-contain border-t border-card-border px-1 pt-1 max-md:max-h-[50dvh] max-md:shrink-0 md:min-h-0 md:flex-1">
                {state.status === "loading" ? <div role="status" aria-label="Loading your clients" className="flex flex-col gap-1">
                    {[0, 1, 2, 3].map(row => <div key={row} aria-hidden="true" className="flex min-h-12 items-center px-1 md:min-h-11"><LoadingPulse className="h-10 w-10 rounded-full" /></div>)}
                </div> : null}
                {state.status === "error" ? <p data-rail-wide role="alert" className="px-2 py-2 text-xs leading-5 text-red-200">{state.message} <button type="button" className="underline underline-offset-2" onClick={() => void load()}>Retry</button></p> : null}
                {shown.map(client => {
                    const href = `/${workspaceSlug}/relationships/${client.id}`
                    const current = activePath === href || client.id === activeClientId
                    return <div role="listitem" key={client.id}>
                        <a href={href} data-global-loading="false" data-rail-client aria-current={current ? "page" : undefined} aria-disabled={!online || undefined}
                            onClick={event => { if (!plainClick(event)) return; event.preventDefault(); if (online) onOpenClient(href) }}
                            className={`${rowClass} ${current ? currentRow : idleRow} ${online ? "" : "cursor-not-allowed opacity-40"}`}>
                            <span aria-hidden="true" className={`${tileClass} text-xs font-semibold ${current ? "bg-neutral-100 text-neutral-950" : "bg-neutral-800 text-neutral-100"}`}>{clientInitials(client.name)}</span>
                            <span data-rail-label className="flex min-w-0 flex-1 flex-col leading-tight">
                                <span className="truncate">{client.name}</span>
                                {client.business ? <span className="truncate text-xs text-neutral-400">{client.business}</span> : null}
                            </span>
                        </a>
                    </div>
                })}
                {state.status === "ready" && clients.length > 0 && shown.length === 0 ? <p data-rail-wide className="px-2 py-2 text-xs text-neutral-400">No client matches.</p> : null}
                {state.status === "ready" && clients.length === 0 ? <p data-rail-wide className="px-2 py-2 text-xs text-neutral-400">No clients yet.</p> : null}
                {state.status === "ready" && state.rail.truncated ? <p data-rail-wide className="px-2 py-2 text-xs leading-5 text-neutral-400">
                    Showing the first {CLIENT_RAIL_LIMIT} by name. <a href={relationshipsHref} data-global-loading="false" className="underline underline-offset-2 hover:text-white"
                        onClick={event => { if (!plainClick(event)) return; event.preventDefault(); onOpenClient(relationshipsHref) }}>All relationships</a>
                </p> : null}
            </div>
        </>}

        <div className="flex shrink-0 flex-col gap-1 border-t border-card-border pt-1">
            {primary.map(item => <Destination key={item.key} item={item} onOpen={onOpenDestination} />)}
            {secondary.length ? <button type="button" data-icon-button aria-expanded={moreShown} aria-controls="client-rail-more" onClick={() => setMoreOpen(open => !open)}
                className={`${rowClass} ${hiddenCurrent ? currentRow : idleRow}`}>
                <span className={tileClass}><MoreIcon /></span>
                <span data-rail-label className="min-w-0 flex-1 truncate">More</span>
            </button> : null}
            {secondary.length ? <div id="client-rail-more" hidden={!moreShown} className="flex flex-col gap-1">
                {moreShown ? secondary.map(item => <Destination key={item.key} item={item} onOpen={onOpenDestination} />) : null}
            </div> : null}
        </div>
    </div>
}
