import { recordVersionKey } from "../record-version.js"

export type ChatReadPosition = { lastReadMessageId: string | null; lastReadAt: string }
export function compareReadPositions(a: ChatReadPosition, b: ChatReadPosition) {
    return recordVersionKey(a.lastReadAt).localeCompare(recordVersionKey(b.lastReadAt))
        || (a.lastReadMessageId ?? "").localeCompare(b.lastReadMessageId ?? "")
}

export function readCursorCoversMessage(cursor: ChatReadPosition, message: { id: string; createdAt: string }) {
    const time = recordVersionKey(cursor.lastReadAt).localeCompare(recordVersionKey(message.createdAt))
    return time > 0 || (time === 0 && (!cursor.lastReadMessageId || cursor.lastReadMessageId >= message.id))
}

export function mergeChatReadCursor<T extends ChatReadPosition & { userId: string }>(current: T[], incoming: T, conversation: (cursor: T) => string): T[] {
    const matches = (cursor: T) => conversation(cursor) === conversation(incoming) && cursor.userId === incoming.userId
    const existing = current.find(matches)
    if (existing && compareReadPositions(existing, incoming) >= 0) return current
    return [...current.filter(cursor => !matches(cursor)), incoming]
}

/** Merge one server/broadcast batch without rescanning all cursors per read. */
export function mergeChatReadCursors<T extends ChatReadPosition & { userId: string }>(current: T[], incoming: readonly T[], conversation: (cursor: T) => string): T[] {
    if (!incoming.length) return current
    if (incoming.length === 1) return mergeChatReadCursor(current, incoming[0], conversation)
    const key = (cursor: T) => `${conversation(cursor)}:${cursor.userId}`
    const positions = new Map(current.map(cursor => [key(cursor), cursor]))
    let changed = false
    for (const cursor of incoming) {
        const cursorKey = key(cursor)
        const existing = positions.get(cursorKey)
        if (existing && compareReadPositions(existing, cursor) >= 0) continue
        // Match the single-update helper's append order for advancing positions.
        positions.delete(cursorKey)
        positions.set(cursorKey, cursor)
        changed = true
    }
    return changed ? [...positions.values()] : current
}

export type ChatReadUpdate = ChatReadPosition & { kind: "client" | "native"; conversationId: string; userId: string; workspaceId: string }
export type ChatReadScope = Pick<ChatReadUpdate, "workspaceId" | "userId" | "kind">
export type ChatReadBatchOptions = { reconcile?: boolean }

/** Normalize only an already-authorized server cursor, never a selected/seen row. */
export function normalizeChatReadUpdate(scope: ChatReadScope, value: unknown): ChatReadUpdate | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const row = value as Record<string, unknown>
    if (!scope.workspaceId || !scope.userId || !["client", "native"].includes(scope.kind)) return null
    if ((row.workspaceId !== undefined && row.workspaceId !== scope.workspaceId)
        || (row.workspace_id !== undefined && row.workspace_id !== scope.workspaceId)
        || (row.kind !== undefined && row.kind !== scope.kind)) return null
    const userId = row.userId ?? row.user_id
    if (userId !== scope.userId || (row.userId !== undefined && row.userId !== scope.userId) || (row.user_id !== undefined && row.user_id !== scope.userId)) return null
    const conversationId = row.conversationId ?? (scope.kind === "client" ? row.relationshipId ?? row.relationship_id : row.conversation_id)
    const conversationKeys = scope.kind === "client" ? ["conversationId", "relationshipId", "relationship_id"] : ["conversationId", "conversation_id"]
    if (conversationKeys.some(key => row[key] !== undefined && row[key] !== conversationId)) return null
    const lastReadAt = row.lastReadAt ?? row.last_read_at
    const lastReadMessageId = row.lastReadMessageId === undefined ? row.last_read_message_id : row.lastReadMessageId
    if (typeof conversationId !== "string" || !conversationId
        || typeof lastReadAt !== "string" || !Number.isFinite(Date.parse(lastReadAt))
        || (lastReadMessageId !== null && (typeof lastReadMessageId !== "string" || !lastReadMessageId))) return null
    return { workspaceId: scope.workspaceId, userId: scope.userId, kind: scope.kind, conversationId, lastReadAt, lastReadMessageId }
}

const eventName = "betelgeze:chat-read"
const channelName = (workspaceId: string, userId: string) => `betelgeze:chat-read:${workspaceId}:${userId}`
function eventHost() { return window.top ?? window }

export function publishChatReads(updates: readonly ChatReadUpdate[], options: ChatReadBatchOptions = {}) {
    const batches = new Map<string, ChatReadUpdate[]>()
    for (const update of updates) {
        const normalized = normalizeChatReadUpdate(update, update)
        if (!normalized) continue
        const key = channelName(normalized.workspaceId, normalized.userId)
        const batch = batches.get(key)
        if (batch) batch.push(normalized)
        else batches.set(key, [normalized])
    }
    for (const [name, reads] of batches) {
        // Keep single-update fields for already-open clients on the old listener.
        const detail = { ...(reads.length === 1 ? reads[0] : {}), reads, reconcile: options.reconcile !== false }
        eventHost().dispatchEvent(new CustomEvent(eventName, { detail }))
        if (typeof BroadcastChannel === "undefined") continue
        const channel = new BroadcastChannel(name)
        // A sibling browser tab does not receive the snapshot caller's host invalidation.
        channel.postMessage({ ...detail, reconcile: true })
        channel.close()
    }
}

export function publishChatRead(update: ChatReadUpdate) {
    publishChatReads([update])
}

export function subscribeChatReadBatches(workspaceId: string, userId: string, receive: (updates: ChatReadUpdate[], options: { reconcile: boolean }) => void) {
    const accept = (value: unknown) => {
        // Accept legacy single-message broadcasts during a mixed-version rollout.
        const envelope = value && typeof value === "object" && "reads" in value ? value as { reads: unknown; reconcile?: unknown } : null
        const candidates = envelope ? envelope.reads : Array.isArray(value) ? value : [value]
        if (!Array.isArray(candidates)) return
        const reads: ChatReadUpdate[] = []
        for (const candidate of candidates) {
            if (!candidate || typeof candidate !== "object") continue
            const row = candidate as ChatReadUpdate
            if (row.workspaceId !== workspaceId || row.userId !== userId) continue
            const read = normalizeChatReadUpdate({ workspaceId, userId, kind: row.kind }, row)
            if (read) reads.push(read)
        }
        if (reads.length) receive(reads, { reconcile: envelope?.reconcile !== false })
    }
    const local = (event: Event) => accept((event as CustomEvent).detail)
    const host = eventHost()
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName(workspaceId, userId))
    if (channel) channel.onmessage = event => accept(event.data)
    host.addEventListener(eventName, local)
    return () => { host.removeEventListener(eventName, local); channel?.close() }
}

export function subscribeChatReads(workspaceId: string, userId: string, receive: (update: ChatReadUpdate) => void) {
    return subscribeChatReadBatches(workspaceId, userId, reads => reads.forEach(receive))
}
