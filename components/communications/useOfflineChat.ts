"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { activateOfflineAccount, cacheOfflineChats, chatKey, deliverOfflineMessage, enqueueOfflineMessage, readOfflineOutbox, startOfflineRecovery, subscribeOffline, type OfflineKind, type OfflineMessage } from "@/public/offline-store.js"

type CachedMessage = { id: string; clientRequestId: string | null; body: string; createdAt: string; senderUserId?: string | null; direction?: string; attachment?: { fileName: string } | null }
type Conversation = { id: string; title: string; messages: CachedMessage[]; canSend?: boolean; canWrite?: boolean }

export function useOfflineChat({ userId, workspaceId, workspaceSlug, kind, conversations, people, onMessage, onRemove }: {
    userId: string; workspaceId: string; workspaceSlug: string; kind: OfflineKind;
    conversations: Conversation[]; people: Array<{ id: string; name: string }>;
    onMessage: (conversationId: string, message: Record<string, unknown>) => void;
    onRemove: (messageId: string) => void;
}) {
    const [entries, setEntries] = useState<OfflineMessage[]>([])
    const [ready, setReady] = useState(false)
    const callbacks = useRef({ onMessage, onRemove, conversations })
    const seen = useRef(new Map<string, string>())
    const mountedAt = useRef(0)
    const initialization = useRef<Promise<void> | null>(null)
    const cachedSignature = useRef("")
    useEffect(() => { callbacks.current = { onMessage, onRemove, conversations } }, [onMessage, onRemove, conversations])

    useEffect(() => {
        mountedAt.current = Date.now()
        const seenEntries = seen.current
        let stopped = false
        let stopRecovery: (() => void) | undefined
        initialization.current = activateOfflineAccount(userId)
        const refresh = () => {
            void readOfflineOutbox(userId).then((all) => {
                if (stopped) return
                const scoped = all.filter((item) => item.workspaceId === workspaceId && item.kind === kind)
                const present = new Set(scoped.map((item) => item.id))
                for (const [id, state] of seen.current) {
                    if (!present.has(id) && state !== "sent") callbacks.current.onRemove(id)
                }
                for (const item of scoped) {
                    const messages = callbacks.current.conversations.find((conversation) => conversation.id === item.conversationId)?.messages
                    const acknowledged = messages?.some((message) => message.clientRequestId === item.id && message.id !== item.id)
                    if (item.state === "sent") {
                        if (item.message && seen.current.get(item.id) !== "sent" && (seen.current.has(item.id) || (!acknowledged && (item.completedAt ?? 0) >= mountedAt.current))) callbacks.current.onMessage(item.conversationId, item.message)
                    } else if (!seen.current.has(item.id) && !acknowledged) {
                        callbacks.current.onMessage(item.conversationId, item.optimistic)
                    }
                    seen.current.set(item.id, item.state)
                }
                setEntries(scoped.filter((item) => item.state !== "sent"))
            }).catch(() => undefined)
        }
        const unsubscribe = subscribeOffline((type) => { if (type === "outbox" || type === "account") refresh() })
        void initialization.current.then(() => {
            if (stopped) return
            setReady(true); refresh(); stopRecovery = startOfflineRecovery(userId)
        }).catch(() => undefined)
        return () => { stopped = true; unsubscribe(); stopRecovery?.(); seenEntries.clear() }
    }, [userId, workspaceId, kind])

    useEffect(() => {
        if (!ready) return
        // Coalesce snapshots, never await storage on the online read/render path.
        const timer = setTimeout(() => {
            if (!navigator.onLine) return
            const names = new Map(people.map((person) => [person.id, person.name]))
            const chats = conversations.slice(0, 60).map((conversation) => ({
                key: chatKey(userId, workspaceId, kind, conversation.id), userId, workspaceId, workspaceSlug, kind,
                conversationId: conversation.id, title: conversation.title,
                canSend: conversation.canWrite ?? conversation.canSend ?? false, savedAt: Date.now(),
                messages: conversation.messages.filter((message) => message.id !== message.clientRequestId).slice(-100).map((message) => ({
                    id: message.id, clientRequestId: message.clientRequestId, body: message.body,
                    sender: message.senderUserId === userId ? "You" : names.get(message.senderUserId ?? "") ?? (message.direction === "inbound" ? conversation.title : "Team"),
                    own: message.senderUserId === userId || (kind === "client" && message.direction === "outbound"),
                    createdAt: message.createdAt, attachmentName: message.attachment?.fileName,
                })),
            }))
            const signature = JSON.stringify(chats.map((chat) => ({ ...chat, savedAt: 0 })))
            if (signature === cachedSignature.current) return
            void cacheOfflineChats(userId, workspaceId, kind, chats).then(() => { cachedSignature.current = signature }).catch(() => undefined)
        }, 1500)
        return () => clearTimeout(timer)
    }, [ready, userId, workspaceId, workspaceSlug, kind, conversations, people])

    const queue = useCallback(async (conversationId: string, title: string, payload: Record<string, unknown>, optimistic: Record<string, unknown>) => {
        const id = String(payload.clientRequestId)
        try {
            await initialization.current
            await enqueueOfflineMessage({ id, userId, workspaceId, workspaceSlug, kind, conversationId, title, payload, optimistic, createdAt: String(optimistic.createdAt) })
        } catch (error) {
            // A browser denying device storage must not break ordinary online
            // sending. Keep the composer until this direct request is confirmed.
            if (!navigator.onLine) throw error
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/communications/${kind === "native" ? "native/" : ""}messages`, {
                method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error",
                body: JSON.stringify({ ...payload, offlineUserId: userId, offlineWorkspaceId: workspaceId }), signal: AbortSignal.timeout(25_000),
            })
            const result = await response.json()
            if (!response.ok || !result.message) throw error
            callbacks.current.onMessage(conversationId, result.message)
            return
        }
        void deliverOfflineMessage(id).catch(() => undefined)
    }, [userId, workspaceId, workspaceSlug, kind])

    return { queue, entries }
}
