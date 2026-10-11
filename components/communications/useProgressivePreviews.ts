"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { MOBILE_CONVERSATION_VISIBILITY_EVENT, mobileConversationIsOpen } from "@/lib/mobile-conversation-viewport"
import { confirmedPreviewCursor, createProgressivePreviewQueue } from "@/lib/communications/progressive-previews"

const subscribeListVisibility = (notify: () => void) => {
    window.addEventListener(MOBILE_CONVERSATION_VISIBILITY_EVENT, notify)
    return () => window.removeEventListener(MOBILE_CONVERSATION_VISIBILITY_EVENT, notify)
}
const listVisibleSnapshot = () => !mobileConversationIsOpen(window)
const serverListVisibleSnapshot = () => true

/** Reuse the existing mobile surface owner; covered lists must not fetch bodies. */
export function useConversationListActive(active: boolean) {
    return useSyncExternalStore(subscribeListVisibility, listVisibleSnapshot, serverListVisibleSnapshot) && active
}

type DeviceCursor = { lastReadAt: string; lastReadMessageId: string | null }
export type ProgressivePreview<M> = { conversationId: string; cursorKnown: true; deviceCursor: DeviceCursor | null; preview: M | null }

type Options<M> = {
    enabled: boolean
    active: boolean
    workspaceSlug: string
    scope: string
    kind: "client" | "native"
    deviceId: string | null
    initialReady: string[]
    onPreview: (items: ProgressivePreview<M>[]) => void
}

export function useProgressivePreviews<M>(options: Options<M>) {
    const listRef = useRef<HTMLDivElement | null>(null)
    const current = useRef(options)
    useLayoutEffect(() => { current.current = options })
    const queue = useRef<ReturnType<typeof createProgressivePreviewQueue<ProgressivePreview<M>>> | null>(null)
    const [failed, setFailed] = useState<Set<string>>(() => new Set())
    useEffect(() => {
        if (!options.enabled) return
        const owner = createProgressivePreviewQueue<ProgressivePreview<M>>({
            initialReady: current.current.initialReady,
            request: async (ids, signal) => {
                const { workspaceSlug, kind, deviceId } = current.current
                const query = new URLSearchParams({ kind, ids: ids.join(","), readProtocol: "device-v1" })
                const response = await fetch(`/api/workspaces/${workspaceSlug}/communications/previews?${query}`, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
                const result = await response.json() as { readProtocol?: string; deviceId?: string; items?: ProgressivePreview<M>[]; error?: string }
                if (!response.ok || result.readProtocol !== "device-v1" || (deviceId && result.deviceId !== deviceId) || !Array.isArray(result.items) || result.items.some(item => item.cursorKnown !== true || !confirmedPreviewCursor(item.deviceCursor))) throw new Error(result.error ?? "Could not load messages.")
                return result.items
            },
            apply: items => {
                current.current.onPreview(items)
                setFailed(previous => new Set([...previous].filter(id => !items.some(item => item.conversationId === id))))
            },
            failed: ids => setFailed(previous => new Set([...previous, ...ids])),
        })
        queue.current = owner
        owner.setActive(current.current.active)
        return () => { owner.dispose(); if (queue.current === owner) queue.current = null }
    }, [options.enabled, options.scope])
    useEffect(() => { queue.current?.setActive(options.active) }, [options.active])
    useEffect(() => {
        const root = listRef.current
        if (!options.enabled || !options.active || !root) return
        const visible = new Set<string>()
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                const id = (entry.target as HTMLElement).dataset.previewConversation
                if (id) { if (entry.isIntersecting && entry.intersectionRatio > 0) visible.add(id); else visible.delete(id) }
            }
            queue.current?.setVisible(visible)
        }, { root, threshold: 0.01 })
        const observed = new Set<Element>()
        const observe = () => {
            const rows = new Set(root.querySelectorAll("[data-preview-conversation]"))
            for (const row of observed) if (!rows.has(row)) { observer.unobserve(row); observed.delete(row); visible.delete((row as HTMLElement).dataset.previewConversation ?? "") }
            for (const row of rows) if (!observed.has(row)) { observed.add(row); observer.observe(row) }
            queue.current?.setVisible(visible)
        }
        observe()
        const changes = new MutationObserver(observe)
        changes.observe(root, { childList: true, subtree: true })
        return () => { observer.disconnect(); changes.disconnect(); queue.current?.setVisible([]) }
    }, [options.active, options.enabled, options.scope])
    const invalidate = useCallback((ids?: Iterable<string>) => { queue.current?.invalidate(ids) }, [])
    const confirm = useCallback((ids: Iterable<string>) => { queue.current?.confirm(ids) }, [])
    const retry = useCallback((id: string) => {
        setFailed(previous => { const next = new Set(previous); next.delete(id); return next })
        queue.current?.retry(id)
    }, [])
    return { listRef, failed, invalidate, confirm, retry }
}
