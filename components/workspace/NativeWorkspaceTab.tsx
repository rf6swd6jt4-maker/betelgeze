"use client"

import { Component, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { nativeWorkspaceRoute } from "@/lib/workspace-native"
import { WorkspaceRecordCache } from "@/lib/workspace-record-cache"
import type { WorkspaceTabScrollStore } from "@/lib/workspace-tab-scroll"
import type { NativeRelationshipsSnapshot } from "@/lib/workspace-native-relationships"
import type { NativeAdminSnapshot } from "@/lib/workspace-native-admin"
import type { NativeWorkSnapshot } from "@/lib/workspace-native-work"
import type { NativeAppointmentSnapshot } from "@/lib/workspace-native-appointment"
import type { NativeLibrarySnapshot } from "@/lib/workspace-native-library"
import { WorkspacePanelChrome } from "./WorkspacePanelChrome"
import { beginWorkspaceInteraction } from "@/lib/workspace-performance"
import { flushWorkspaceAutosaves } from "@/lib/workspace-mutations"
import { WORKSPACE_TAB_MESSAGE_SOURCE, workspaceRouteIsRecordDetail, type WorkspaceTabFrameMessage, type WorkspaceTabParentMessage } from "@/lib/workspace-tabs"
import { parseWorkspaceDetailPreview } from "@/lib/workspace-detail-preview"
import { WorkspaceNavigationProvider, type WorkspaceNavigation } from "./WorkspaceNavigation"
import { WorkspaceTabOpeningState } from "./WorkspaceTabOpeningState"

// One Suspense boundary owns both content and readiness. An inner loading
// boundary could otherwise report a panel ready before its code has arrived.
const RelationshipsPanel = lazy(() => import("./NativeRelationshipsPanel"))
const LibraryPanel = lazy(() => import("./NativeLibraryPanel"))
const WorkPanel = lazy(() => import("./NativeWorkPanel"))
const AdminPanel = lazy(() => import("./NativeAdminPanel"))
const AppointmentPanel = lazy(() => import("./NativeAppointmentPanel"))
export type NativePanelSnapshot = NativeRelationshipsSnapshot | NativeLibrarySnapshot | NativeWorkSnapshot | NativeAdminSnapshot | NativeAppointmentSnapshot
export type NativeTabHandle = { post: (message: Omit<WorkspaceTabParentMessage, "source" | "target" | "tabId">) => void }

export function nativePanelCacheKey(userId: string, workspaceId: string, routeKey: string) { return `${userId}:${workspaceId}:${routeKey}` }

export async function readNativePanel({ url, workspaceSlug, workspaceId, userId, signal }: { url: string; workspaceSlug: string; workspaceId: string; userId: string; signal: AbortSignal }): Promise<NativePanelSnapshot> {
    const route = nativeWorkspaceRoute(url, workspaceSlug)
    if (!route) throw new Error("This panel is not available in the native workspace")
    const query = new URLSearchParams(new URL(route.key, "http://workspace.invalid").search)
    if (route.relationshipId) query.set("id", route.relationshipId)
    if (route.kind === "assets" || route.kind === "work-items") query.set("kind", route.kind)
    if (route.section) query.set("section", route.section)
    const endpoint = route.kind === "assets" || route.kind === "work-items" ? "library" : route.kind
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/panels/${endpoint}?${query}`, {
        cache: "no-store", credentials: "same-origin", headers: { "x-workspace-user": userId }, signal,
    })
    if (response.redirected || [401, 403, 404, 409].includes(response.status)) throw new NativePanelAccessError("Access changed. Reload the workspace to continue.")
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Could not load this panel. Please retry.")
    const data = await response.json() as NativePanelSnapshot
    if (data.userId !== userId || data.workspaceId !== workspaceId || data.workspaceSlug !== workspaceSlug) throw new NativePanelAccessError("Your workspace session changed. Reload to continue.")
    return data
}

class NativePanelAccessError extends Error {}

function NativePanel({ data }: { data: NativePanelSnapshot }) {
    switch (data.kind) {
        case "relationships": case "relationship-detail": return <RelationshipsPanel data={data} />
        case "assets": case "asset-detail": case "work-items": case "work-item-detail": return <LibraryPanel data={data} />
        case "work": case "work-detail": return <WorkPanel data={data} />
        case "appointment-setting": case "appointment-detail": return <AppointmentPanel data={data} />
        default: return <AdminPanel data={data} />
    }
}

class PanelBoundary extends Component<{ children: ReactNode; onRetry: () => void; onFailure: () => void }, { failed: boolean }> {
    state = { failed: false }
    static getDerivedStateFromError() { return { failed: true } }
    componentDidCatch() { this.props.onFailure() }
    render() {
        return this.state.failed ? <div role="alert" className="p-6 text-sm text-red-200">This panel could not open. <button type="button" onClick={() => { this.setState({ failed: false }); this.props.onRetry() }} className="underline">Retry</button></div> : this.props.children
    }
}

function Ready({ onReady }: { onReady: () => void }) {
    useEffect(() => {
        let second = 0
        const first = requestAnimationFrame(() => { second = requestAnimationFrame(onReady) })
        return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
    }, [onReady])
    return null
}

function RestoreScroll({ onRestore }: { onRestore: () => void }) {
    // This mounts inside Suspense, after the actual panel content is present.
    // Restoring when only its loading skeleton exists would clamp the offset.
    useLayoutEffect(onRestore, [onRestore])
    return null
}

export function NativeWorkspaceTab({ tab, active, contextOpen, workspaceId, workspaceSlug, userId, cache, accountCleared, scrollPositions, assignRef, onMessage, banner }: {
    tab: { id: string; url: string; title: string }
    active: boolean
    contextOpen: boolean
    workspaceId: string
    workspaceSlug: string
    userId: string
    cache: WorkspaceRecordCache<NativePanelSnapshot>
    accountCleared: boolean
    scrollPositions: WorkspaceTabScrollStore
    assignRef: (tabId: string, handle: NativeTabHandle | null) => void
    onMessage: (message: WorkspaceTabFrameMessage) => void
    banner?: ReactNode
}) {
    const root = useRef<HTMLDivElement>(null)
    const restoredScrollKey = useRef<string | null>(null)
    const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const prefetchReads = useRef(new Set<string>())
    useEffect(() => () => { if (prefetchTimer.current) clearTimeout(prefetchTimer.current) }, [])
    const [navigationError, setNavigationError] = useState<string | null>(null)
    const [accessError, setAccessError] = useState<{ key: string; message: string } | null>(null)
    const navigationSequence = useRef(0)
    const current = useRef({ tab, active, accountCleared })
    useLayoutEffect(() => { current.current = { tab, active, accountCleared } }, [tab, active, accountCleared])
    const route = nativeWorkspaceRoute(tab.url, workspaceSlug)!
    const key = nativePanelCacheKey(userId, workspaceId, route.key)
    const scrollKey = `${tab.id}:${tab.url}`
    const restoreScroll = useCallback(() => {
        if (active && root.current) {
            root.current.scrollTop = scrollPositions.get(scrollKey)
            restoredScrollKey.current = scrollKey
        }
    }, [active, scrollPositions, scrollKey])
    const snapshot = useSyncExternalStore(useCallback((notify) => cache.subscribe(key, notify), [cache, key]), useCallback(() => cache.getSnapshot(key), [cache, key]), useCallback(() => cache.getSnapshot(key), [cache, key]))
    const post = useCallback((message: Omit<WorkspaceTabFrameMessage, "source" | "target" | "tabId">) => onMessage({ source: WORKSPACE_TAB_MESSAGE_SOURCE, target: "host", tabId: tab.id, ...message }), [onMessage, tab.id])
    const read = useCallback((force = false) => cache.load(key, (signal) => readNativePanel({ url: tab.url, workspaceSlug, workspaceId, userId, signal }), { force }).catch((error: unknown) => {
        if (error instanceof NativePanelAccessError) {
            // Removing private data must not also remove the recovery message.
            setAccessError({ key, message: error.message })
            cache.clear()
        }
        throw error
    }), [cache, key, tab.url, workspaceSlug, workspaceId, userId])
    const refresh = useCallback(() => {
        if (current.current.accountCleared || accessError?.key === key) return
        if (!current.current.active || current.current.tab.url !== tab.url) {
            cache.invalidate((candidate) => candidate === key)
            return
        }
        void read(true).catch(() => undefined)
    }, [read, cache, key, tab.url, accessError])
    const reportLocation = useCallback(() => post({ type: "location", url: current.current.tab.url }), [post])
    const measurement = useRef<ReturnType<typeof beginWorkspaceInteraction> | null>(null)
    const blockedByAccess = accountCleared || accessError?.key === key

    useEffect(() => {
        if (!active || blockedByAccess) return
        const interaction = beginWorkspaceInteraction({ workspaceSlug, operation: "panel_load", routeSection: route.kind, renderer: "native", cacheState: cache.getSnapshot(key).data ? "memory" : "network", background: false })
        measurement.current = interaction
        void read().catch((error: unknown) => {
            if (error instanceof Error && error.name === "AbortError") return
            interaction.finish("failed")
            if (!cache.getSnapshot(key).data) post({ type: "navigation-failed", url: tab.url })
        })
        return () => { interaction.finish("aborted") }
        // Invalidation increments revision once; settling a read does not.
    }, [cache, key, read, workspaceSlug, route.kind, active, blockedByAccess, snapshot.revision, post, tab.url])

    useEffect(() => {
        const resume = () => {
            if (!current.current.active || blockedByAccess || document.visibilityState !== "visible") return
            // The cache coalesces focus + visibility events and only refreshes
            // snapshots older than 30 seconds (or explicitly invalidated).
            void read().catch(() => undefined)
        }
        window.addEventListener("focus", resume)
        window.addEventListener("online", resume)
        document.addEventListener("visibilitychange", resume)
        return () => {
            window.removeEventListener("focus", resume)
            window.removeEventListener("online", resume)
            document.removeEventListener("visibilitychange", resume)
        }
    }, [read, blockedByAccess])

    const onReady = useCallback(() => {
        if (!active || blockedByAccess) return
        reportLocation()
        post({ type: "meaningful-ready", url: tab.url })
        measurement.current?.mark("meaningful_ready")
        measurement.current?.finish("completed", "meaningful_ready")
        const title = root.current?.querySelector<HTMLElement>("[data-workspace-record-title]")?.dataset.workspaceRecordTitle
        if (title) post({ type: "record-title", url: tab.url, title })
        window.dispatchEvent(new Event("betelgeze:clear-loading"))
    }, [post, reportLocation, tab.url, active, blockedByAccess])

    useEffect(() => {
        assignRef(tab.id, { post(message) {
            if (message.type === "activate" && message.active && message.refresh) refresh()
            if (message.type === "probe" && !blockedByAccess && cache.getSnapshot(key).data) reportLocation()
            // Shell navigation changes tab.url; the data key effect owns loading.
        } })
        return () => assignRef(tab.id, null)
    }, [assignRef, tab.id, refresh, reportLocation, cache, key, blockedByAccess])

    useEffect(() => {
        const context = snapshot.data?.context ?? null
        post({ type: "context-status", contextSupported: Boolean(context), relationshipId: context?.id ?? null, context })
    }, [post, snapshot.data?.context])

    useEffect(() => {
        if (!active) {
            const focused = document.activeElement
            if (focused instanceof HTMLElement && root.current?.contains(focused)) focused.blur()
        }
    }, [active])

    const navigate = useCallback(async (href: string, replace = false) => {
        if (!current.current.active || current.current.accountCleared) return
        const sequence = ++navigationSequence.current
        const sourceUrl = current.current.tab.url
        const destination = new URL(href, new URL(sourceUrl, window.location.origin))
        const url = `${destination.pathname}${destination.search}${destination.hash}`
        if (destination.origin === window.location.origin && url === sourceUrl) return
        post({ type: "navigation-intent", url, replace, intentSequence: sequence })
        const safe = await flushWorkspaceAutosaves(1500, { navigation: true })
        if (sequence !== navigationSequence.current || !current.current.active || current.current.tab.url !== sourceUrl || current.current.accountCleared) {
            post({ type: "navigation-intent-end", intentSequence: sequence, interactionOutcome: "aborted" })
            return
        }
        if (!safe) {
            post({ type: "navigation-intent-end", intentSequence: sequence, interactionOutcome: "failed" })
            setNavigationError("Your changes are not safely saved yet. Retry saving before leaving this panel.")
            return
        }
        setNavigationError(null)
        if (destination.origin !== window.location.origin || !destination.pathname.startsWith(`/${workspaceSlug}/`)) { window.location.assign(destination.href); return }
        post({ type: replace ? "location-replace" : "navigation-start", url })
    }, [post, workspaceSlug])
    const navigation = useMemo<WorkspaceNavigation>(() => ({
        tabId: tab.id, workspaceSlug, url: tab.url, active,
        push: (href) => { void navigate(href) }, replace: (href) => { void navigate(href, true) }, refresh,
        back: () => post({ type: "history-step", historyDelta: -1 }), forward: () => post({ type: "history-step", historyDelta: 1 }),
        prefetch: (href) => {
            const destination = new URL(href, window.location.origin)
            if (blockedByAccess || current.current.accountCleared || !current.current.active || destination.origin !== window.location.origin || prefetchReads.current.size >= 2) return
            const target = nativeWorkspaceRoute(href, workspaceSlug)
            if (!target || prefetchReads.current.has(target.key)) return
            prefetchReads.current.add(target.key)
            void cache.load(nativePanelCacheKey(userId, workspaceId, target.key), (signal) => readNativePanel({ url: href, workspaceSlug, workspaceId, userId, signal }))
                .catch(() => undefined).finally(() => prefetchReads.current.delete(target.key))
        },
        context: (context) => post({ type: "context-status", contextSupported: Boolean(context), relationshipId: context?.id ?? null, context }),
    }), [tab.id, tab.url, workspaceSlug, workspaceId, userId, active, navigate, refresh, cache, post, blockedByAccess])

    return <WorkspaceNavigationProvider value={navigation}><div ref={root} hidden={!active} aria-hidden={!active} data-native-workspace-tab={tab.id} data-native-context-open={contextOpen ? "true" : "false"} className="absolute inset-0 overflow-y-auto bg-neutral-950"
        onScroll={(event) => { if (active && !blockedByAccess && restoredScrollKey.current === scrollKey && snapshot.data) scrollPositions.set(scrollKey, event.currentTarget.scrollTop) }}
        onClickCapture={(event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]")
            if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return
            const destination = new URL(anchor.href, window.location.origin)
            if (destination.origin !== window.location.origin || !destination.pathname.startsWith(`/${workspaceSlug}/`)) return
            event.preventDefault()
            event.stopPropagation()
            const url = `${destination.pathname}${destination.search}${destination.hash}`
            if (workspaceRouteIsRecordDetail(url, workspaceSlug, window.location.origin)) {
                post({ type: "open-tab", url, detailPreview: parseWorkspaceDetailPreview(anchor.dataset.workspaceDetailPreview ?? null) ?? undefined })
            } else void navigate(url)
        }}
        onPointerOver={(event) => {
            const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]")
            if (prefetchTimer.current) clearTimeout(prefetchTimer.current)
            if (anchor && event.pointerType === "mouse") prefetchTimer.current = setTimeout(() => navigation.prefetch(anchor.href), 200)
        }}
        onPointerLeave={() => { if (prefetchTimer.current) clearTimeout(prefetchTimer.current) }}>
        {navigationError ? <div role="alert" className="px-4 py-2 text-sm text-red-200">{navigationError}</div> : null}
        {blockedByAccess ? <div role="alert" className="px-4 py-2 text-sm text-red-200">{accountCleared ? "Your workspace session changed. Reload to continue." : accessError?.message} <button type="button" onClick={() => window.location.reload()} className="underline">Reload workspace</button></div> : null}
        {snapshot.error ? <div role="alert" className="border-b border-red-900/50 px-4 py-2 text-sm text-red-200">{snapshot.error} <button type="button" onClick={refresh} className="underline">Retry</button></div> : null}
        <WorkspacePanelChrome banner={banner}><PanelBoundary key={key} onRetry={refresh} onFailure={() => { measurement.current?.finish("failed"); post({ type: "navigation-failed", url: tab.url }) }}><Suspense fallback={<WorkspaceTabOpeningState url={tab.url} workspaceSlug={workspaceSlug} />}>
            {!blockedByAccess && (snapshot.data ? <><NativePanel data={snapshot.data} /><RestoreScroll onRestore={restoreScroll} /><Ready key={snapshot.updatedAt} onReady={onReady} /></> : <WorkspaceTabOpeningState url={tab.url} workspaceSlug={workspaceSlug} />)}
        </Suspense></PanelBoundary></WorkspacePanelChrome>
    </div></WorkspaceNavigationProvider>
}
