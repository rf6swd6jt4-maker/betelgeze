"use client"

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { PanelRouteLoading } from "@/components/workspace/PanelRouteLoading"
import { CommunicationsReadProtocolContext, useCommunicationsReadProtocol } from "./CommunicationsReadProtocol"
import type { CommunicationReadProtocol } from "@/lib/communications/read-protocol"
import { useCommunicationsUnread } from "./useCommunicationsUnread"
import { useSharedUnreadSummary } from "./useSharedUnreadSummary"
import { invalidateUnreadSummary } from "@/lib/communications/unread-broadcast"
import { Status } from "@/components/ui"
import { createCommunicationsModeResource, type CommunicationsMode } from "@/lib/communications/mode-resource"
import { DEFAULT_CONVERSATION_LIST_WIDTH } from "@/components/communications/ResizableConversationColumns"
import type { CommunicationsBootstrap } from "@/lib/communications/types"
import type { NativeCommunicationsBootstrap } from "@/lib/teams/types"
import { WORKSPACE_TAB_FRAME_PARAM, WORKSPACE_TAB_MESSAGE_SOURCE, type WorkspaceTabFrameMessage } from "@/lib/workspace-tabs"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { afterVisibleWorkspacePaint } from "@/lib/workspace-navigation-lifecycle"

const CommunicationsWorkspace = lazy(() => import("@/components/communications/CommunicationsWorkspace").then((module) => ({ default: module.CommunicationsWorkspace })))
const TeamCommunicationsWorkspace = lazy(() => import("@/components/communications/TeamCommunicationsWorkspace").then((module) => ({ default: module.TeamCommunicationsWorkspace })))

function ContentReady({ active, onMounted, onReady }: { active: boolean; onMounted?: () => void; onReady?: () => void }) {
    useEffect(() => {
        if (!active) return
        onMounted?.()
        if (!onReady) return
        return afterVisibleWorkspacePaint(onReady, {
            visible: () => document.visibilityState === "visible",
            requestFrame: callback => requestAnimationFrame(callback),
            cancelFrame: frame => cancelAnimationFrame(frame),
            subscribe: update => {
                document.addEventListener("visibilitychange", update)
                return () => document.removeEventListener("visibilitychange", update)
            },
        })
    }, [active, onMounted, onReady])
    return null
}

export function CommunicationsPanel({ readProtocol: requestedReadProtocol, deferredScope, clientBootstrap: initialClientBootstrap, nativeBootstrap: initialNativeBootstrap, initialMode, initialConversationId, initialNativeConversationId, initialDmUserId, onMounted, onReady }: {
    readProtocol?: CommunicationReadProtocol
    deferredScope?: { workspaceId: string; workspaceSlug: string; userId: string }
    clientBootstrap: CommunicationsBootstrap | null
    nativeBootstrap: NativeCommunicationsBootstrap | null
    initialMode: CommunicationsMode
    initialConversationId?: string
    initialNativeConversationId?: string
    initialDmUserId?: string
    onMounted?: () => void
    onReady?: () => void
}) {
    const navigation = useWorkspaceNavigation()
    const panelActive = navigation?.active ?? true
    const initialBootstrap = initialClientBootstrap ?? initialNativeBootstrap
    const hasInitialBootstrap = Boolean(initialBootstrap)
    const initialReadProtocol = initialBootstrap?.readProtocol ?? "account-v1"
    const { workspaceId, workspaceSlug } = initialBootstrap ?? deferredScope!
    const userId = initialBootstrap?.currentUser.id ?? deferredScope!.userId
    const readProtocol = useCommunicationsReadProtocol(workspaceId, userId, requestedReadProtocol ?? initialBootstrap?.readProtocol ?? "account-v1")
    const compatible = (bootstrap: CommunicationsBootstrap | NativeCommunicationsBootstrap | null) => bootstrap && (bootstrap.readProtocol ?? "account-v1") === readProtocol
    const [standalone, setStandalone] = useState(false)
    useEffect(() => { setStandalone(window.top === window && document.body.dataset.workspaceTabsHosted !== "true" && !document.querySelector("[data-workspace-shell-root]")) }, [])
    // Hosted panels consume the shell's owner. Standalone routes need one owner.
    useCommunicationsUnread(workspaceId, workspaceSlug, userId, standalone, readProtocol)
    const invalidateUnread = useCallback((eventKey?: string) => invalidateUnreadSummary(workspaceId, userId, eventKey), [workspaceId, userId])
    const [clientBootstrap, setClientBootstrap] = useState(compatible(initialClientBootstrap) ? initialClientBootstrap : null)
    const [nativeBootstrap, setNativeBootstrap] = useState(compatible(initialNativeBootstrap) ? initialNativeBootstrap : null)
    const [loadErrors, setLoadErrors] = useState<Partial<Record<CommunicationsMode, string>>>({})
    const requestedObservation = useRef(false)
    const bindingModes = useRef(new Set<CommunicationsMode>())
    const pendingModeLoads = useRef(new Map<CommunicationsMode, Promise<CommunicationsBootstrap | NativeCommunicationsBootstrap>>())
    const resources = useRef<ReturnType<typeof createCommunicationsModeResource<CommunicationsBootstrap | NativeCommunicationsBootstrap>> | null>(null)
    const [mode, setModeState] = useState(initialMode)
    const [clientSelectedId, setClientSelectedId] = useState(initialClientBootstrap?.selectedConversationId ?? initialConversationId ?? null)
    const [nativeSelectedId, setNativeSelectedId] = useState(initialNativeBootstrap?.requestedConversationId ?? initialNativeConversationId ?? null)

    const loadMode = useCallback(async (nextMode: CommunicationsMode) => {
        const resource = resources.current
        if (!resource) return
        setLoadErrors((errors) => ({ ...errors, [nextMode]: undefined }))
        try {
            const pending = resource.load(nextMode)
            pendingModeLoads.current.set(nextMode, pending)
            const bootstrap = await pending
            bindingModes.current.delete(nextMode)
            if (!bindingModes.current.size) requestedObservation.current = false
            if (resources.current !== resource) return
            if (nextMode === "clients") setClientBootstrap(bootstrap as CommunicationsBootstrap)
            else setNativeBootstrap(bootstrap as NativeCommunicationsBootstrap)
        } catch (error) {
            if (resources.current === resource) setLoadErrors((errors) => ({ ...errors, [nextMode]: error instanceof Error ? error.message : "Could not load conversations." }))
        } finally { pendingModeLoads.current.delete(nextMode) }
    }, [])

    useEffect(() => {
        const resource = createCommunicationsModeResource<CommunicationsBootstrap | NativeCommunicationsBootstrap>({
            workspaceId, userId,
            load: async (nextMode, signal) => {
                const query = new URLSearchParams({ readProtocol })
                const conversation = nextMode === "clients" ? initialConversationId : initialNativeConversationId
                if (conversation) query.set("conversation", conversation)
                if (nextMode === "team" && initialDmUserId) query.set("dm", initialDmUserId)
                const path = nextMode === "clients" ? "sync" : "native/conversations"
                const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
                const response = await fetch(`/api/workspaces/${workspaceSlug}/communications/${path}?${query}`, { cache: "no-store", signal: requestSignal })
                if (readProtocol === "device-v1" && response.status === 409) {
                    bindingModes.current.add(nextMode)
                    if (!requestedObservation.current) {
                        requestedObservation.current = true
                        ;(window.top ?? window).dispatchEvent(new Event("betelgeze:device-observation-required"))
                    }
                }
                if (!response.ok) throw new Error("Could not load conversations. Please retry.")
                const result = await response.json()
                requestSignal.throwIfAborted()
                if ((result.readProtocol ?? "account-v1") !== readProtocol) throw new Error("Conversation protocol changed. Reload the workspace to continue.")
                return result
            },
        })
        resources.current = resource
        if (!hasInitialBootstrap || initialReadProtocol !== readProtocol) void loadMode(initialMode)
        const host = window.top ?? window
        const observed = () => {
            if (readProtocol !== "device-v1" || !requestedObservation.current) return
            for (const failedMode of bindingModes.current) {
                // If observation wins the response-settlement race, wait until
                // that failed slot is released before the one recovery load.
                const pending = pendingModeLoads.current.get(failedMode)
                void Promise.resolve(pending).catch(() => undefined).then(() => {
                    if (resources.current === resource && bindingModes.current.has(failedMode)) void loadMode(failedMode)
                })
            }
        }
        host.addEventListener("betelgeze:device-observed", observed)
        // Preserve both-mode unread updates, without blocking initial rendering.
        // Two animation frames allow the visible view to paint first.
        let secondFrame = 0
        const firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => { void loadMode(initialMode === "clients" ? "team" : "clients") })
        })
        return () => {
            host.removeEventListener("betelgeze:device-observed", observed)
            cancelAnimationFrame(firstFrame)
            cancelAnimationFrame(secondFrame)
            if (resources.current === resource) resources.current = null
            resource.dispose()
        }
    }, [initialConversationId, initialDmUserId, initialMode, initialNativeConversationId, hasInitialBootstrap, initialReadProtocol, loadMode, readProtocol, userId, workspaceId, workspaceSlug])
    const [accountClientUnreadCount, setClientUnreadCount] = useState(0)
    const [accountNativeUnreadCount, setNativeUnreadCount] = useState(0)
    const sharedSummary = useSharedUnreadSummary(workspaceId, userId, readProtocol)
    const deviceCounts = sharedSummary?.loaded ? sharedSummary.rows.reduce((counts, row) => {
        counts[row.kind] += row.count
        return counts
    }, { client: 0, native: 0 }) : null
    const clientUnreadCount = readProtocol === "device-v1" ? deviceCounts?.client : accountClientUnreadCount
    const nativeUnreadCount = readProtocol === "device-v1" ? deviceCounts?.native : accountNativeUnreadCount
    const [conversationListWidth, setConversationListWidth] = useState(DEFAULT_CONVERSATION_LIST_WIDTH)
    const unreadCount = clientUnreadCount === undefined || nativeUnreadCount === undefined ? undefined : clientUnreadCount + nativeUnreadCount

    useEffect(() => {
        const stored = Number(localStorage.getItem(`betelgeze:communications:list-width:${workspaceId}`))
        if (!Number.isFinite(stored) || stored < 288 || stored > 448) return
        const timer = window.setTimeout(() => setConversationListWidth(stored), 0)
        return () => window.clearTimeout(timer)
    }, [workspaceId])

    useEffect(() => {
        if (navigation || unreadCount === undefined) return
        const tabId = new URL(window.location.href).searchParams.get(WORKSPACE_TAB_FRAME_PARAM)
        if (!tabId || window.parent === window) return
        const message: WorkspaceTabFrameMessage = {
            source: WORKSPACE_TAB_MESSAGE_SOURCE,
            target: "host",
            tabId,
            type: "communications-unread",
            unreadCount,
        }
        window.parent.postMessage(message, window.location.origin)
    }, [unreadCount, navigation])

    useEffect(() => {
        if (navigation && !navigation.active) return
        const url = new URL(navigation?.url ?? window.location.href, window.location.origin)
        url.searchParams.set("mode", mode)
        if (clientSelectedId) url.searchParams.set("conversation", clientSelectedId)
        else url.searchParams.delete("conversation")
        if (nativeSelectedId) {
            url.searchParams.set("nativeConversation", nativeSelectedId)
            url.searchParams.delete("dm")
        } else url.searchParams.delete("nativeConversation")

        if (navigation) {
            const nextUrl = `${url.pathname}${url.search}${url.hash}`
            if (nextUrl === navigation.url) return
            // The shell owns history. Leave the effect before its synchronous
            // current-source commit and cancel obsolete route continuations.
            let cancelled = false
            queueMicrotask(() => { if (!cancelled) navigation.replace(nextUrl) })
            return () => { cancelled = true }
        }

        const tabId = url.searchParams.get(WORKSPACE_TAB_FRAME_PARAM)
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
        if (!tabId || window.parent === window) return
        const shellUrl = new URL(url)
        shellUrl.searchParams.delete(WORKSPACE_TAB_FRAME_PARAM)
        shellUrl.searchParams.delete("readProtocol")
        const message: WorkspaceTabFrameMessage = {
            source: WORKSPACE_TAB_MESSAGE_SOURCE,
            target: "host",
            tabId,
            type: "location-replace",
            url: `${shellUrl.pathname}${shellUrl.search}${shellUrl.hash}`,
        }
        window.parent.postMessage(message, window.location.origin)
    }, [clientSelectedId, mode, nativeSelectedId, navigation])

    const setMode = useCallback((next: "clients" | "team") => {
        setModeState(next)
        if (next === "clients" ? !clientBootstrap : !nativeBootstrap) void loadMode(next)
    }, [clientBootstrap, loadMode, nativeBootstrap])

    const setSharedConversationListWidth = useCallback((width: number) => {
        setConversationListWidth(width)
        localStorage.setItem(`betelgeze:communications:list-width:${workspaceId}`, String(width))
    }, [workspaceId])
    return <CommunicationsReadProtocolContext.Provider value={readProtocol}><div data-communications-panel className={`${navigation ? "absolute" : "fixed"} inset-0 isolate overflow-hidden overscroll-none bg-black [contain:paint]`}>
        {clientBootstrap ? <div className={mode === "clients" ? "absolute inset-0" : "hidden"} aria-hidden={mode !== "clients"}><Suspense fallback={<PanelRouteLoading variant="communications" />}>
            <CommunicationsWorkspace
                active={panelActive && mode === "clients"}
                bootstrap={clientBootstrap}
                onOpenTeam={() => setMode("team")}
                onSelectedConversationChange={setClientSelectedId}
                onUnreadCountChange={setClientUnreadCount}
                onUnreadInvalidated={invalidateUnread}
                teamUnreadCount={nativeUnreadCount}
                conversationListWidth={conversationListWidth}
                onConversationListWidthChange={setSharedConversationListWidth}
            />
            <ContentReady active={panelActive && mode === "clients"} onMounted={onMounted} onReady={onReady} />
        </Suspense></div> : null}
        {nativeBootstrap ? <div className={mode === "team" ? "absolute inset-0" : "hidden"} aria-hidden={mode !== "team"}><Suspense fallback={<PanelRouteLoading variant="communications-team" />}>
            <TeamCommunicationsWorkspace
                active={panelActive && mode === "team"}
                bootstrap={nativeBootstrap}
                onOpenClients={() => setMode("clients")}
                onSelectedConversationChange={setNativeSelectedId}
                onUnreadCountChange={setNativeUnreadCount}
                onUnreadInvalidated={invalidateUnread}
                clientUnreadCount={clientUnreadCount}
                conversationListWidth={conversationListWidth}
                onConversationListWidthChange={setSharedConversationListWidth}
            />
            <ContentReady active={panelActive && mode === "team"} onMounted={onMounted} onReady={onReady} />
        </Suspense></div> : null}
        {!(mode === "clients" ? clientBootstrap : nativeBootstrap) ? <>
            <PanelRouteLoading variant={mode === "clients" ? "communications" : "communications-team"} />
            <div className="absolute inset-x-0 bottom-8 z-10 flex items-center justify-center gap-3 bg-black px-4 py-3 text-xs">
                <Status tone={loadErrors[mode] ? "red" : "grey"} label={loadErrors[mode] ?? "Loading conversations…"} />
                {loadErrors[mode] ? <button type="button" onClick={() => { void loadMode(mode) }} className="text-neutral-300 hover:text-white">Retry</button> : null}
                <button type="button" onClick={() => setMode(initialMode)} className="text-neutral-300 hover:text-white">Back</button>
            </div>
        </> : null}
    </div></CommunicationsReadProtocolContext.Provider>
}
