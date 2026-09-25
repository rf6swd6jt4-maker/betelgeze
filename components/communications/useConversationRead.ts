"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"
import { chatDocumentHasAttention, useChatDocumentAttention } from "./useChatDocumentAttention"
import { workspaceDocumentIsActive } from "@/lib/workspace-tab-activity"
import { CHAT_READING_VISIBILITY_EVENT, latestMessageIsVisible } from "@/lib/communications/reading-visibility"
import { observeChatReadingVisibility } from "@/lib/communications/reading-observer"
import { beginWorkspaceInteraction } from "@/lib/workspace-performance"
import { createChatReadQueue } from "@/lib/communications/read-queue"
import { compareReadPositions, publishChatRead, type ChatReadPosition, type ChatReadUpdate } from "@/lib/communications/read-state"
import { dismissReadChatNotification } from "@/lib/push/browser-notifications"
import { WORKSPACE_TAB_FRAME_PARAM } from "@/lib/workspace-tabs"

export function useConversationRead(input: {
    workspaceId: string; workspaceSlug: string; userId: string; kind: "client" | "native"
    conversationId: string | null; latest: { id: string; createdAt: string } | undefined
    cursor: ChatReadPosition | undefined; active: boolean; atLatest: boolean
    pane: RefObject<HTMLDivElement | null>
}) {
    const { workspaceId, workspaceSlug, userId, kind, conversationId, latest, cursor, active, atLatest, pane } = input
    const tabId = useWorkspaceNavigation()?.tabId
    const tabActive = useWorkspaceTabActive()
    const { attentive } = useChatDocumentAttention()
    const [error, setError] = useState<string | null>(null)
    const queue = useRef<ReturnType<typeof createChatReadQueue> | null>(null)
    const latestId = latest?.id
    const latestAt = latest?.createdAt
    const isReading = useCallback(() => Boolean(active && tabActive && atLatest && latestId
        && workspaceDocumentIsActive(tabId) && chatDocumentHasAttention()
        && latestMessageIsVisible(pane.current, latestId)), [active, atLatest, latestId, pane, tabActive, tabId])

    useEffect(() => {
        const ownerId = tabId ?? new URLSearchParams(window.location.search).get(WORKSPACE_TAB_FRAME_PARAM) ?? (window.name || "standalone")
        const storageKey = `betelgeze:chat-reads:v1:${workspaceId}:${userId}:${kind}:${ownerId}`
        const controller = new AbortController()
        const owner = createChatReadQueue({
            load: () => {
                const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]")
                return Array.isArray(value) ? value.filter((row): row is ChatReadUpdate => row?.workspaceId === workspaceId && row?.userId === userId && row?.kind === kind
                    && typeof row.conversationId === "string" && typeof row.lastReadMessageId === "string" && Number.isFinite(Date.parse(row.lastReadAt))).slice(0, 256) : []
            },
            store: rows => { if (rows.length) sessionStorage.setItem(storageKey, JSON.stringify(rows)); else sessionStorage.removeItem(storageKey) },
            save: async read => {
                const timing = beginWorkspaceInteraction({ workspaceSlug, operation: "command", command: "message.read", routeSection: "communications", cacheState: "network", background: !chatDocumentHasAttention() || !workspaceDocumentIsActive(tabId) })
                try {
                    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/communications/${kind === "native" ? "native/" : ""}read`, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
                        body: JSON.stringify({ [kind === "native" ? "conversationId" : "relationshipId"]: read.conversationId, messageId: read.lastReadMessageId }),
                    })
                    const result = await response.json()
                    if (!response.ok || !result.cursor) throw new Error("Read save failed")
                    const confirmed = { ...read, ...result.cursor }
                    if (confirmed.userId !== read.userId || confirmed.workspaceId !== read.workspaceId || confirmed.kind !== read.kind
                        || confirmed.conversationId !== read.conversationId || compareReadPositions(confirmed, read) < 0) throw new Error("Read position was not acknowledged")
                    timing.mark("server_ack")
                    timing.finish("completed", "server_ack")
                    return confirmed
                } catch (error) { timing.finish(controller.signal.aborted ? "aborted" : "failed"); throw error }
            },
            acknowledge: read => {
                publishChatRead(read)
                void dismissReadChatNotification(read.conversationId, read.lastReadAt, read.lastReadMessageId)
            },
            error: setError,
        })
        queue.current = owner
        const recover = () => { if (navigator.onLine && document.visibilityState === "visible") void owner.flush() }
        window.addEventListener("online", recover)
        window.addEventListener("focus", recover)
        document.addEventListener("visibilitychange", recover)
        recover()
        return () => {
            owner.dispose(); controller.abort()
            if (queue.current === owner) queue.current = null
            window.removeEventListener("online", recover)
            window.removeEventListener("focus", recover)
            document.removeEventListener("visibilitychange", recover)
        }
    }, [kind, tabId, userId, workspaceId, workspaceSlug])

    useLayoutEffect(() => {
        if (!active || !tabActive || !attentive || !conversationId || !latestId || !latestAt) return
        let first = 0, second = 0
        let lastReading: boolean | undefined
        let dismissed = false
        const position = { lastReadMessageId: latestId, lastReadAt: latestAt }
        const unread = !cursor || compareReadPositions(cursor, position) < 0
        // A mounted/selected row is not evidence it has painted. Recheck geometry
        // and shell identity after painting, including native resident tabs.
        const check = () => {
            cancelAnimationFrame(first); cancelAnimationFrame(second)
            first = requestAnimationFrame(() => {
                second = requestAnimationFrame(() => {
                    const reading = isReading()
                    if (reading !== lastReading) {
                        lastReading = reading
                        window.dispatchEvent(new Event(CHAT_READING_VISIBILITY_EVENT))
                    }
                    if (!reading) return
                    if (cursor && compareReadPositions(cursor, position) >= 0) {
                        if (!dismissed) {
                            dismissed = true
                            void dismissReadChatNotification(conversationId, cursor.lastReadAt, cursor.lastReadMessageId)
                        }
                        return
                    }
                    queue.current?.observe({ ...position, workspaceId, userId, kind, conversationId })
                })
            })
        }
        const stopObserving = observeChatReadingVisibility(window, () => pane.current, latestId, check, { interactions: unread })
        return () => {
            stopObserving()
            cancelAnimationFrame(first); cancelAnimationFrame(second)
        }
    }, [active, attentive, conversationId, cursor, isReading, kind, latestAt, latestId, pane, tabActive, userId, workspaceId])

    const flush = useCallback(async () => { await queue.current?.flush() }, [])
    return { isReading, flush, error }
}
