"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { PanelRouteLoading } from "@/components/workspace/PanelRouteLoading"
import { Status } from "@/components/ui"
import { createCommunicationsModeResource, type CommunicationsMode } from "@/lib/communications/mode-resource"
import { CommunicationsActivityTracker } from "@/components/communications/CommunicationsActivityTracker"
import { DEFAULT_CONVERSATION_LIST_WIDTH } from "@/components/communications/ResizableConversationColumns"
import type { CommunicationsConnectionState } from "@/components/communications/useReliableCommunicationsRealtime"
import type { CommunicationsBootstrap } from "@/lib/communications/types"
import type { NativeCommunicationsBootstrap } from "@/lib/teams/types"
import { WORKSPACE_TAB_FRAME_PARAM, WORKSPACE_TAB_MESSAGE_SOURCE, type WorkspaceTabFrameMessage } from "@/lib/workspace-tabs"

const CommunicationsWorkspace = dynamic(() => import("@/components/communications/CommunicationsWorkspace").then((module) => module.CommunicationsWorkspace), { loading: () => <PanelRouteLoading variant="communications" /> })
const TeamCommunicationsWorkspace = dynamic(() => import("@/components/communications/TeamCommunicationsWorkspace").then((module) => module.TeamCommunicationsWorkspace), { loading: () => <PanelRouteLoading variant="communications-team" /> })

export function CommunicationsPanel({ clientBootstrap: initialClientBootstrap, nativeBootstrap: initialNativeBootstrap, initialMode, initialConversationId, initialNativeConversationId, initialDmUserId }: {
    clientBootstrap: CommunicationsBootstrap | null
    nativeBootstrap: NativeCommunicationsBootstrap | null
    initialMode: CommunicationsMode
    initialConversationId?: string
    initialNativeConversationId?: string
    initialDmUserId?: string
}) {
    const initialBootstrap = initialClientBootstrap ?? initialNativeBootstrap!
    const { workspaceId, workspaceSlug } = initialBootstrap
    const userId = initialBootstrap.currentUser.id
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
    const [clientConnectionState, setClientConnectionState] = useState<CommunicationsConnectionState>("connecting")
    const [nativeConnectionState, setNativeConnectionState] = useState<CommunicationsConnectionState>("connecting")
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
    }, [unreadCount])

    useEffect(() => {
        const url = new URL(window.location.href)
        url.searchParams.set("mode", mode)
        if (clientSelectedId) url.searchParams.set("conversation", clientSelectedId)
        else url.searchParams.delete("conversation")
        if (nativeSelectedId) {
            url.searchParams.set("nativeConversation", nativeSelectedId)
            url.searchParams.delete("dm")
        } else url.searchParams.delete("nativeConversation")

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
    }, [clientSelectedId, mode, nativeSelectedId])

    const setMode = useCallback((next: "clients" | "team") => {
        setModeState(next)
        if (next === "clients" ? !clientBootstrap : !nativeBootstrap) void loadMode(next)
    }, [clientBootstrap, loadMode, nativeBootstrap])

    const setSharedConversationListWidth = useCallback((width: number) => {
        setConversationListWidth(width)
        localStorage.setItem(`betelgeze:communications:list-width:${workspaceId}`, String(width))
    }, [workspaceId])
    return <div data-communications-panel className="fixed inset-0 isolate overflow-hidden overscroll-none bg-black [contain:paint]">
        <CommunicationsActivityTracker
            connectionState={mode === "clients" ? clientConnectionState : nativeConnectionState}
            conversationId={mode === "clients" ? clientSelectedId : nativeSelectedId}
            conversationKind={mode === "clients" ? "client" : "native"}
            workspaceId={workspaceId}
        />
        {clientBootstrap ? <div className={mode === "clients" ? "absolute inset-0" : "hidden"} aria-hidden={mode !== "clients"}>
            <CommunicationsWorkspace
                active={mode === "clients"}
                bootstrap={clientBootstrap}
                onConnectionStateChange={setClientConnectionState}
                onOpenTeam={() => setMode("team")}
                onSelectedConversationChange={setClientSelectedId}
                onUnreadCountChange={setClientUnreadCount}
                teamUnreadCount={nativeUnreadCount}
                conversationListWidth={conversationListWidth}
                onConversationListWidthChange={setSharedConversationListWidth}
            />
        </div> : null}
        {nativeBootstrap ? <div className={mode === "team" ? "absolute inset-0" : "hidden"} aria-hidden={mode !== "team"}>
            <TeamCommunicationsWorkspace
                active={mode === "team"}
                bootstrap={nativeBootstrap}
                onConnectionStateChange={setNativeConnectionState}
                onOpenClients={() => setMode("clients")}
                onSelectedConversationChange={setNativeSelectedId}
                onUnreadCountChange={setNativeUnreadCount}
                clientUnreadCount={clientUnreadCount}
                conversationListWidth={conversationListWidth}
                onConversationListWidthChange={setSharedConversationListWidth}
            />
        </div> : null}
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
