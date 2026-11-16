"use client"

import { createContext, useCallback, useContext, useSyncExternalStore } from "react"

const WIDE_QUERY = "(min-width: 1024px)"

/** True only at desktop width (`lg` up) in the Today layout: where the docked Comms panel is offered. */
export function useTodayWide(enabled: boolean) {
    return useSyncExternalStore(
        useCallback((notify: () => void) => {
            if (!enabled) return () => undefined
            const query = window.matchMedia(WIDE_QUERY)
            // resize as well as change: some environments resize without a media-query change event. React re-renders
            // only when the boolean snapshot flips, so this adds no render work while resizing.
            query.addEventListener("change", notify)
            window.addEventListener("resize", notify)
            return () => { query.removeEventListener("change", notify); window.removeEventListener("resize", notify) }
        }, [enabled]),
        () => enabled && window.matchMedia(WIDE_QUERY).matches,
        () => false,
    )
}

/**
 * What the Today layout's shell offers the pages it shows. Present only in that layout; the tabbed layout, framed pages
 * and standalone routes get null and keep their existing form. Pages never navigate on their own: they ask the shell.
 */
export type TodayLayoutShell = {
    /** Open (or return to) a destination through the shell's resident owner. */
    open: (href: string) => void
    /** Dock this client's conversation beside the work. Absent where the dock is not offered (below `lg`). */
    chat?: (client: { id: string; title: string }) => void
}

const TodayLayoutContext = createContext<TodayLayoutShell | null>(null)

export const TodayLayoutProvider = TodayLayoutContext.Provider

export function useTodayLayout() { return useContext(TodayLayoutContext) }
