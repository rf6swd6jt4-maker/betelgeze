"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { createGalleryMediaSession, type GalleryMediaMetadata } from "@/lib/communications/gallery-media-session"

export function useGalleryMediaSession(items: GalleryMediaMetadata[], initialIndex: number) {
    const [store] = useState(() => {
        const listeners = new Set<() => void>()
        return {
            session: createGalleryMediaSession(items, initialIndex, () => listeners.forEach((listener) => listener())),
            subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        }
    })
    const snapshot = useSyncExternalStore(store.subscribe, store.session.getSnapshot, store.session.getSnapshot)
    useEffect(() => {
        const visibility = () => store.session.setEnabled(document.visibilityState === "visible")
        visibility()
        document.addEventListener("visibilitychange", visibility)
        return () => { document.removeEventListener("visibilitychange", visibility) }
    }, [store])
    useEffect(() => {
        if (snapshot.pending === null) return
        const pending = snapshot.pending
        const timer = window.setTimeout(() => store.session.timeout(pending), 15_000)
        return () => window.clearTimeout(timer)
    }, [snapshot.pending, store])
    return { ...snapshot, session: store.session }
}
