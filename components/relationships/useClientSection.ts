"use client"

import { useCallback, useEffect, useSyncExternalStore } from "react"
import type { createSectionRead, SectionState } from "@/lib/client-section-read"

const idle: SectionState<never> = { data: null, error: null, loading: false }

/** Shows one section's shared read. It reads when `enabled` first becomes true, and again only through `reload`. */
export function useClientSection<T>(store: ReturnType<typeof createSectionRead<T>>, key: string, url: string, userId: string, enabled: boolean) {
    const state = useSyncExternalStore(
        useCallback(listener => store.subscribe(key, listener), [store, key]),
        () => store.snapshot(key),
        () => idle as SectionState<T>,
    )
    useEffect(() => { if (enabled) void store.read(key, url, userId) }, [enabled, store, key, url, userId])
    const reload = useCallback(() => { void store.read(key, url, userId, true) }, [store, key, url, userId])
    return { ...state, reload }
}
