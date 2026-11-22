"use client"

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react"
import { LoadingPulse } from "@/components/panel/PanelLoading"
import { clientInitials } from "@/lib/client-rail"

type RailCampaign = { id: string; name: string; status: string; notBooked: number }
type State = { status: "loading" } | { status: "ready"; campaigns: RailCampaign[] } | { status: "error" } | { status: "hidden" }

const STALE_MS = 5 * 60_000
const SIDEBAR_QUERY = "(min-width: 768px)"
const memory = new Map<string, { state: State; at: number }>()

const rowClass = "relative flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] md:min-h-8 md:text-[13px]"
const idleRow = "text-neutral-400 hover:bg-[var(--color-surface-hover)] hover:text-neutral-100"
const currentRow = "bg-[var(--color-surface-selected)] text-white"

function plainClick(event: MouseEvent) {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/**
 * The sidebar's Campaigns section (pilot): each campaign by name with how many of its leads are not booked, and +
 * for a new one. Read once after the shell is up, again when the window returns after five minutes or when a
 * campaign it does not list is opened. Nothing is read while the sidebar is not shown.
 */
export function CampaignRail({ workspaceSlug, userId, activePath, online, onOpen }: {
    workspaceSlug: string; userId: string; activePath: string; online: boolean; onOpen: (href: string) => void
}) {
    const key = `${userId}:${workspaceSlug}`
    const [state, setState] = useState<State>(() => memory.get(key)?.state ?? { status: "loading" })
    const lastRead = useRef(memory.get(key)?.at ?? 0)
    const load = useCallback(async (signal?: AbortSignal) => {
        const started = Date.now()
        lastRead.current = started
        try {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/campaigns/rail`, {
                cache: "no-store", redirect: "error", credentials: "same-origin", headers: { "x-workspace-user": userId },
                signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
            })
            const value = await response.json() as { allowed?: boolean; campaigns?: RailCampaign[] }
            if (signal?.aborted) return
            if (!response.ok || !Array.isArray(value.campaigns)) { setState(current => current.status === "ready" ? current : { status: "error" }); return }
            const next: State = value.allowed === false ? { status: "hidden" } : { status: "ready", campaigns: value.campaigns }
            memory.set(key, { state: next, at: started })
            setState(next)
        } catch {
            if (signal?.aborted) { if (lastRead.current === started) lastRead.current = 0; return }
            setState(current => current.status === "ready" ? current : { status: "error" })
        }
    }, [workspaceSlug, userId, key])

    useEffect(() => {
        const controller = new AbortController()
        const shown = window.matchMedia(SIDEBAR_QUERY)
        const refresh = () => { if (shown.matches && document.visibilityState === "visible" && Date.now() - lastRead.current >= STALE_MS) void load(controller.signal) }
        refresh()
        document.addEventListener("visibilitychange", refresh)
        window.addEventListener("focus", refresh)
        shown.addEventListener("change", refresh)
        return () => { controller.abort(); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); shown.removeEventListener("change", refresh) }
    }, [load])

    // A campaign just created (or renamed elsewhere) is opened before this list knows it: read the list again once.
    const base = `/${workspaceSlug}/campaigns`
    const openId = activePath.startsWith(`${base}/`) ? activePath.slice(base.length + 1).split("/")[0] : null
    const known = state.status === "ready" && (!openId || openId === "new" || state.campaigns.some(campaign => campaign.id === openId))
    const asked = useRef<string | null>(null)
    useEffect(() => {
        if (state.status !== "ready" || known || !openId || asked.current === openId) return
        asked.current = openId
        const controller = new AbortController()
        void load(controller.signal)
        return () => controller.abort()
    }, [state.status, known, openId, load])

    if (state.status === "hidden") return null
    const open = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => { if (!plainClick(event)) return; event.preventDefault(); if (online) onOpen(href) }
    const newHref = `${base}/new`
    return <div data-campaign-rail className="flex flex-col gap-0.5">
        <p data-rail-section className="mt-3 flex min-h-7 items-center px-2 text-xs text-neutral-500">
            <span data-rail-label className="flex-1">Campaigns</span>
            <a href={newHref} data-global-loading="false" data-rail-label aria-label="New campaign" title="New campaign" onClick={open(newHref)}
                className="-mr-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-base leading-none text-neutral-500 hover:bg-[var(--color-surface-hover)] hover:text-white">+</a>
        </p>
        {state.status === "loading" ? <div role="status" aria-label="Loading campaigns" className="flex min-h-12 items-center px-2 md:min-h-8"><LoadingPulse className="h-5 w-5 rounded-[5px]" /></div> : null}
        {state.status === "error" ? <p data-rail-wide role="alert" className="px-2 py-1 text-xs text-red-200">Could not load campaigns. <button type="button" className="underline underline-offset-2" onClick={() => void load()}>Retry</button></p> : null}
        {state.status === "ready" ? state.campaigns.map(campaign => {
            const href = `${base}/${campaign.id}`
            const current = activePath === href || activePath.startsWith(`${href}/`)
            return <a key={campaign.id} href={href} data-global-loading="false" data-rail-campaign title={campaign.name} aria-current={current ? "page" : undefined} aria-disabled={!online || undefined}
                onClick={open(href)} className={`${rowClass} ${current ? currentRow : idleRow} ${online ? "" : "cursor-not-allowed opacity-40"}`}>
                <span aria-hidden="true" className={`relative flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[10px] font-semibold ${current ? "bg-neutral-100 text-neutral-950" : "bg-white/[0.08] text-neutral-300"}`}>{clientInitials(campaign.name)}</span>
                <span data-rail-label className="min-w-0 flex-1 truncate">{campaign.name}</span>
                {campaign.notBooked ? <span data-rail-label title={`${campaign.notBooked} not booked`} className="shrink-0 text-xs tabular-nums text-neutral-500">{campaign.notBooked}</span> : null}
            </a>
        }) : null}
        {state.status === "ready" && !state.campaigns.length ? <p data-rail-wide className="px-2 py-1 text-xs text-neutral-500">No campaigns yet.</p> : null}
    </div>
}
