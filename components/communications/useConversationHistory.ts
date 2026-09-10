"use client"

import { useEffect, useRef, useState } from "react"
import { COMMUNICATION_HISTORY_BOUNDARY_ID, communicationHistoryCursor, type CommunicationHistoryCursor, type CommunicationHistoryPage } from "@/lib/communications/history-page"

const PAGE_SIZE = 60
type Message = { id: string; clientRequestId: string | null; createdAt?: string }
const key = (message: Message) => message.clientRequestId ?? message.id

/** Expand upward without evicting mounted messages as new messages arrive. */
export function useConversationHistory<M extends Message>(conversationId: string | null, messages: M[], remote?: {
    hasMore: boolean
    load: (before: CommunicationHistoryCursor, signal: AbortSignal) => Promise<CommunicationHistoryPage<M>>
}) {
    const firstKey = () => messages.length ? key(messages[Math.max(0, messages.length - PAGE_SIZE)]) : null
    const [window, setWindow] = useState(() => ({ conversationId, first: firstKey() }))
    const [page, setPage] = useState<{ conversationId: string | null; before: CommunicationHistoryCursor | null; hasMore: boolean | null; loading: boolean; error: string | null }>({ conversationId, before: null, hasMore: null, loading: false, error: null })
    const pending = useRef<AbortController | null>(null)
    useEffect(() => () => { pending.current?.abort(); pending.current = null }, [conversationId])
    if (window.conversationId !== conversationId || (!window.first && messages.length)) setWindow({ conversationId, first: firstKey() })
    if (page.conversationId !== conversationId) setPage({ conversationId, before: null, hasMore: null, loading: false, error: null })
    const index = window.conversationId === conversationId && window.first ? messages.findIndex((message) => key(message) === window.first) : -1
    const startIndex = index < 0 ? Math.max(0, messages.length - PAGE_SIZE) : index
    function reveal(messageId?: string, fetchedMessage?: Message) {
        const target = messageId ? messages.findIndex((message) => message.id === messageId) : Math.max(0, startIndex - PAGE_SIZE)
        if (target < 0 && fetchedMessage && fetchedMessage.id === messageId) {
            setWindow({ conversationId, first: key(fetchedMessage) })
            return true
        }
        if (target >= 0 && target < startIndex) {
            setWindow({ conversationId, first: key(messages[target]) })
            return true
        }
        return false
    }
    const hasRemoteHistory = Boolean(remote && (page.hasMore ?? remote.hasMore))
    async function loadEarlier() {
        if (startIndex > 0) { reveal(); return }
        if (!remote || !hasRemoteHistory || pending.current) return
        const oldest = messages.map(communicationHistoryCursor).filter((cursor): cursor is CommunicationHistoryCursor => cursor !== null)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0]
        // Legacy snapshots cap by timestamp alone. Re-read the boundary tie
        // group once so a bulk insert at that timestamp cannot leave a gap.
        const before = page.before ?? (oldest ? { createdAt: oldest.createdAt, id: COMMUNICATION_HISTORY_BOUNDARY_ID } : null)
        if (!before) return
        const controller = new AbortController()
        pending.current = controller
        setPage((current) => ({ ...current, loading: true, error: null }))
        try {
            const result = await remote.load(before, controller.signal)
            if (controller.signal.aborted) return
            setPage({ conversationId, before: result.nextBefore, hasMore: result.hasMore, loading: false, error: null })
            const first = result.messages[0]
            if (first) reveal(first.id, first)
        } catch (error) {
            if (!controller.signal.aborted) setPage((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : "Could not load earlier messages." }))
        } finally { if (pending.current === controller) pending.current = null }
    }
    return { startIndex, reveal, loadEarlier, hasEarlier: startIndex > 0 || hasRemoteHistory, loadingEarlier: page.loading, historyError: page.error }
}
