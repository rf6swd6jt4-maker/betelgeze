"use client"

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { PanelRouteLoading } from "@/components/workspace/PanelRouteLoading"
import { useCommunicationsUnread } from "./useCommunicationsUnread"
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

export function CommunicationsPanel({ clientBootstrap: initialClientBootstrap, nativeBootstrap: initialNativeBootstrap, initialMode, initialConversationId, initialNativeConversationId, initialDmUserId, onMounted, onReady }: {
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
    const initialBootstrap = initialClientBootstrap ?? initialNativeBootstrap!
    const { workspaceId, workspaceSlug } = initialBootstrap
    const userId = initialBootstrap.currentUser.id
    const [standalone, setStandalone] = useState(false)
    useEffect(() => { setStandalone(window.top === window && document.body.dataset.workspaceTabsHosted !== "true") }, [])
    // Hosted panels consume the shell's owner. Standalone routes need one owner.
    useCommunicationsUnread(workspaceId, workspaceSlug, userId, standalone)
    const [clientBootstrap, setClientBootstrap] = useState(initialClientBootstrap)
    const [nativeBootstrap, setNativeBootstrap] = useState(initialNativeBootstrap)
    const [loadErrors, setLoadErrors] = useState<Partial<Record<CommunicationsMode, string>>>({})
    const resources = useRef<ReturnType<typeof createCommunicationsModeResource<CommunicationsBootstrap | NativeCommunicationsBootstrap>> | null>(null)
    const [mode, setModeState] = useState(initialMode)
    const [clientSelectedId, setClientSelectedId] = useState(initialClientBootstrap?.selectedConversationId ?? initialConversationId ?? null)
    const [nativeSelectedId, setNativeSelectedId] = useState(initialNativeBootstrap?.requestedConversationId ?? initialNativeConversationId ?? null)

    const loadMode = useCallback(async (nextMode: CommunicationsMode) => {
        const resource = resources.current
        if (!resource) return
        setLoadErrors((errors) => ({ ...errors, [nextMode]: undefined }))
        try {
            const bootstrap = await resource.load(nextMode)
            if (resources.current !== resource) return
            if (nextMode === "clients") setClientBootstrap(bootstrap as CommunicationsBootstrap)
            else setNativeBootstrap(bootstrap as NativeCommunicationsBootstrap)
        } catch (error) {
            if (resources.current === resource) setLoadErrors((errors) => ({ ...errors, [nextMode]: error instanceof Error ? error.message : "Could not load conversations." }))
        }
    }, [])

    useEffect(() => {
        const resource = createCommunicationsModeResource<CommunicationsBootstrap | NativeCommunicationsBootstrap>({
            workspaceId, userId,
            load: async (nextMode, signal) => {
                const query = new URLSearchParams()
                const conversation = nextMode === "clients" ? initialConversationId : initialNativeConversationId
                if (conversation) query.set("conversation", conversation)
                if (nextMode === "team" && initialDmUserId) query.set("dm", initialDmUserId)
                const path = nextMode === "clients" ? "sync" : "native/conversations"
                const response = await fetch(`/api/workspaces/${workspaceSlug}/communications/${path}?${query}`, { cache: "no-store", signal })
                if (!response.ok) throw new Error("Could not load conversations. Please retry.")
                return response.json()
            },
        })
        resources.current = resource
        // Preserve both-mode unread updates, without blocking initial rendering.
        // Two animation frames allow the visible view to paint first.
        let secondFrame = 0
        const firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => { void loadMode(initialMode === "clients" ? "team" : "clients") })
        })
        return () => {
            cancelAnimationFrame(firstFrame)
            cancelAnimationFrame(secondFrame)
            if (resources.current === resource) resources.current = null
            resource.dispose()
        }
    }, [initialConversationId, initialDmUserId, initialMode, initialNativeConversationId, loadMode, userId, workspaceId, workspaceSlug])
    const [clientUnreadCount, setClientUnreadCount] = useState(0)
    const [nativeUnreadCount, setNativeUnreadCount] = useState(0)
    const [conversationListWidth, setConversationListWidth] = useState(DEFAULT_CONVERSATION_LIST_WIDTH)
    const unreadCount = clientUnreadCount + nativeUnreadCount

    useEffect(() => {
        const stored = Number(localStorage.getItem(`betelgeze:communications:list-width:${workspaceId}`))
        if (!Number.isFinite(stored) || stored < 288 || stored > 448) return
        const timer = window.setTimeout(() => setConversationListWidth(stored), 0)
        return () => window.clearTimeout(timer)
    }, [workspaceId])

    useEffect(() => {
        if (navigation) return
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
    return <div data-communications-panel className={`${navigation ? "absolute" : "fixed"} inset-0 isolate overflow-hidden overscroll-none bg-black [contain:paint]`}>
        {clientBootstrap ? <div className={mode === "clients" ? "absolute inset-0" : "hidden"} aria-hidden={mode !== "clients"}><Suspense fallback={<PanelRouteLoading variant="communications" />}>
            <CommunicationsWorkspace
                active={panelActive && mode === "clients"}
                bootstrap={clientBootstrap}
                onOpenTeam={() => setMode("team")}
                onSelectedConversationChange={setClientSelectedId}
                onUnreadCountChange={setClientUnreadCount}
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
    </div>
}
