"use client"

import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { WorkspaceNavigationProvider, type WorkspaceNavigation } from "./WorkspaceNavigation"
import { WorkspaceTabOpeningState } from "./WorkspaceTabOpeningState"
import type { NativeTabHandle, NativeTabNavigationCommit, NativeTabNavigationRequest } from "./NativeWorkspaceTab"
import { WorkspaceRecordCache } from "@/lib/workspace-record-cache"
import { CommunicationsHostAccessError, communicationsLocation, readNativeCommunications, type NativeCommunicationsSnapshot } from "@/lib/communications/native-host"
import { WORKSPACE_TAB_MESSAGE_SOURCE, workspaceTabRecordTitleForUrl, type WorkspaceTabFrameMessage } from "@/lib/workspace-tabs"
import { COMMUNICATIONS_RECOVERY_EVENT } from "@/components/communications/useReliableCommunicationsRealtime"
import { CommunicationsRuntime } from "@/components/communications/CommunicationsRuntime"

const CommunicationsPanel = lazy(() => import("@/components/communications/CommunicationsPanel").then(module => ({ default: module.CommunicationsPanel })))

class Boundary extends Component<{ children: ReactNode; retry: () => void; failed: () => void }, { failed: boolean }> {
    state = { failed: false }
    static getDerivedStateFromError() { return { failed: true } }
    componentDidCatch() { this.props.failed() }
    render() {
        return this.state.failed ? <div role="alert" className="p-4 text-sm text-red-200">Conversations could not open. <button type="button" className="underline" onClick={() => { this.setState({ failed: false }); this.props.retry() }}>Retry</button></div> : this.props.children
    }
}

/** A resident chat shares the shell document, but retains its own identity and state. */
export function NativeCommunicationsTab({ tab, active, workspaceId, workspaceSlug, userId, cache, accountCleared, assignRef, onMessage, prepareNavigation }: {
    tab: { id: string; url: string }
    active: boolean
    workspaceId: string
    workspaceSlug: string
    userId: string
    cache: WorkspaceRecordCache<NativeCommunicationsSnapshot>
    accountCleared: boolean
    assignRef: (tabId: string, handle: NativeTabHandle | null) => void
    onMessage: (message: WorkspaceTabFrameMessage) => void
    prepareNavigation: (request: NativeTabNavigationRequest) => NativeTabNavigationCommit | null
}) {
    const root = useRef<HTMLDivElement>(null)
    const owner = useRef({})
    const current = useRef({ tab, active, accountCleared })
    useLayoutEffect(() => { current.current = { tab, active, accountCleared } }, [tab, active, accountCleared])
    // Local selections replace only the tab location. Explicit shell navigation
    // starts a new route session, after the shell's normal draft checkpoint.
    const [session, setSession] = useState({ sourceUrl: tab.url, acknowledgedUrl: tab.url, revision: 0 })
    if (tab.url !== session.acknowledgedUrl) setSession({ sourceUrl: tab.url, acknowledgedUrl: tab.url, revision: session.revision + 1 })
    const currentSession = useRef(session)
    useLayoutEffect(() => { currentSession.current = session }, [session])
    const key = `${userId}:${workspaceId}:${session.sourceUrl}`
    const snapshot = useSyncExternalStore(useCallback(notify => cache.subscribe(key, notify), [cache, key]), useCallback(() => cache.getSnapshot(key), [cache, key]), useCallback(() => cache.getSnapshot(key), [cache, key]))
    const [accessError, setAccessError] = useState<string | null>(null)
    const blocked = accountCleared || Boolean(accessError)
    const committed = useRef<{ revision: number; sourceUrl: string } | null>(null)
    const sequence = useRef(0)
    const post = useCallback((message: Omit<WorkspaceTabFrameMessage, "source" | "target" | "tabId">) => {
        onMessage({ source: WORKSPACE_TAB_MESSAGE_SOURCE, target: "host", tabId: tab.id, ...message })
    }, [onMessage, tab.id])
    const reportMounted = useCallback(() => {
        if (blocked || !current.current.active || current.current.accountCleared) return
        if (current.current.tab.url !== tab.url || currentSession.current.revision !== session.revision || currentSession.current.sourceUrl !== session.sourceUrl) return
        committed.current = { revision: session.revision, sourceUrl: session.sourceUrl }
        post({ type: "location", url: tab.url })
    }, [blocked, post, tab.url, session.revision, session.sourceUrl])
    const reportReady = useCallback(() => {
        if (blocked || !current.current.active || current.current.accountCleared || document.visibilityState !== "visible" || current.current.tab.url !== tab.url || currentSession.current.revision !== session.revision || currentSession.current.sourceUrl !== session.sourceUrl) return
        reportMounted()
        post({ type: "meaningful-ready", url: tab.url })
    }, [blocked, post, reportMounted, tab.url, session.revision, session.sourceUrl])
    const reportFailure = useCallback(() => {
        committed.current = null
        post({ type: "navigation-failed", url: tab.url })
    }, [post, tab.url])
    const read = useCallback((force = false) => cache.load(key, signal => readNativeCommunications({ url: session.sourceUrl, workspaceSlug, workspaceId, userId, signal }), {
        force, discardDataOnError: error => error instanceof CommunicationsHostAccessError,
    }).catch((error: unknown) => {
        if (error instanceof CommunicationsHostAccessError) { setAccessError(error.message); cache.clear() }
        throw error
    }), [cache, key, session.sourceUrl, workspaceSlug, workspaceId, userId])
    useEffect(() => {
        if (!active || blocked || snapshot.data || snapshot.error) return
        void read().catch(() => post({ type: "navigation-failed", url: session.sourceUrl }))
    }, [active, blocked, snapshot.data, snapshot.error, read, post, session.sourceUrl])
    const refresh = useCallback(() => {
        if (blocked || !current.current.active) return
        if (snapshot.data) window.dispatchEvent(new Event(COMMUNICATIONS_RECOVERY_EVENT))
        else void read(true).catch(() => post({ type: "navigation-failed", url: session.sourceUrl }))
    }, [blocked, snapshot.data, read, post, session.sourceUrl])
    useLayoutEffect(() => {
        assignRef(tab.id, { owner: owner.current, post(message) {
            if (message.type === "retry") refresh()
            if (message.type === "activate" && message.active && message.refresh) refresh()
            if (message.type === "probe" && committed.current?.revision === session.revision && committed.current.sourceUrl === session.sourceUrl) reportMounted()
        } })
        return () => assignRef(tab.id, null)
    }, [assignRef, tab.id, refresh, reportMounted, session.revision, session.sourceUrl])
    useLayoutEffect(() => {
        if (active) return
        const focused = document.activeElement
        if (focused instanceof HTMLElement && root.current?.contains(focused)) focused.blur()
    }, [active])
    const replace = useCallback((href: string) => {
        if (!current.current.active || current.current.accountCleared || blocked) return
        const sourceUrl = current.current.tab.url
        const destination = new URL(href, new URL(sourceUrl, window.location.origin))
        if (destination.origin !== window.location.origin || !communicationsLocation(destination.href, workspaceSlug)) return
        const url = `${destination.pathname}${destination.search}${destination.hash}`
        if (url === sourceUrl) return
        const intentSequence = ++sequence.current
        const commit = prepareNavigation({ tabId: tab.id, sourceUrl, url, replace: true, userId, workspaceId, intentSequence })
        if (!commit) return
        // No owner is discarded for a local conversation/mode selection. The
        // shell still validates account, active tab, source URL and capability.
        setSession(value => ({ ...value, acknowledgedUrl: url }))
        if (!commit(() => current.current.active && !current.current.accountCleared && current.current.tab.url === sourceUrl)) {
            setSession(value => ({ ...value, acknowledgedUrl: sourceUrl }))
        }
    }, [blocked, prepareNavigation, tab.id, userId, workspaceId, workspaceSlug])
    const navigation = useMemo<WorkspaceNavigation>(() => ({
        tabId: tab.id, workspaceSlug, url: tab.url, active: active && !blocked,
        replace,
        push: href => { if (current.current.active) post({ type: "open-tab", url: href }) },
        refresh,
        back: () => { if (current.current.active) post({ type: "history-step", historyDelta: -1 }) },
        forward: () => { if (current.current.active) post({ type: "history-step", historyDelta: 1 }) },
        prefetch: () => {},
        context: context => post({ type: "context-status", contextSupported: Boolean(context), relationshipId: context?.id ?? null, context }),
    }), [tab.id, tab.url, workspaceSlug, active, blocked, replace, refresh, post])
    useEffect(() => {
        if (active && committed.current?.revision === session.revision && committed.current.sourceUrl === session.sourceUrl) reportMounted()
    }, [active, tab.url, reportMounted, session.revision, session.sourceUrl])
    useEffect(() => {
        if (!active || blocked || !root.current) return
        let previous = ""
        const reportTitle = () => {
            if (!current.current.active || current.current.tab.url !== tab.url || committed.current?.revision !== session.revision || committed.current.sourceUrl !== session.sourceUrl) return
            const name = root.current?.querySelector<HTMLElement>("[data-workspace-record-title]")?.dataset.workspaceRecordTitle ?? ""
            const title = workspaceTabRecordTitleForUrl(tab.url, workspaceSlug, name)
            if (title === previous) return
            previous = title
            post({ type: "record-title", url: tab.url, title })
        }
        reportTitle()
        const observer = new MutationObserver(reportTitle)
        observer.observe(root.current, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-workspace-record-title"] })
        return () => observer.disconnect()
    }, [active, blocked, tab.url, workspaceSlug, post, session.revision, session.sourceUrl])
    return <WorkspaceNavigationProvider value={navigation}><div ref={root} hidden={!active} inert={!active} aria-hidden={!active} data-mobile-comms-tab={tab.id} data-active={active ? "true" : "false"} className="absolute inset-0 overflow-hidden bg-black"
        onClickCapture={event => {
            if (!active || blocked || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]")
            if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self") || anchor.getAttribute("href")?.startsWith("#")) return
            const destination = new URL(anchor.href, window.location.origin)
            if (destination.origin !== window.location.origin || !destination.pathname.startsWith(`/${workspaceSlug}/`)) return
            event.preventDefault()
            event.stopPropagation()
            // Record links retain this conversation and its draft as the
            // shell opens the same independent destination tab as the bridge.
            navigation.push(`${destination.pathname}${destination.search}${destination.hash}`)
        }}>
        {blocked ? <div role="alert" className="p-4 text-sm text-red-200">{accessError ?? "Your workspace session changed. Reload to continue."} <button className="underline" onClick={() => window.location.reload()}>Reload workspace</button></div> : snapshot.error ? <div role="alert" className="p-4 text-sm text-red-200">{snapshot.error} <button type="button" className="underline" onClick={refresh}>Retry</button></div> : snapshot.data ? <Boundary key={`${key}:${session.revision}`} retry={refresh} failed={reportFailure}><Suspense fallback={<WorkspaceTabOpeningState url={tab.url} workspaceSlug={workspaceSlug} />}>
            <CommunicationsRuntime><CommunicationsPanel clientBootstrap={snapshot.data.clientBootstrap} nativeBootstrap={snapshot.data.nativeBootstrap} initialMode={snapshot.data.mode} initialConversationId={snapshot.data.conversationId} initialNativeConversationId={snapshot.data.nativeConversationId} initialDmUserId={snapshot.data.dmUserId} onMounted={reportMounted} onReady={reportReady} /></CommunicationsRuntime>
        </Suspense></Boundary> : <WorkspaceTabOpeningState url={tab.url} workspaceSlug={workspaceSlug} />}
    </div></WorkspaceNavigationProvider>
}
