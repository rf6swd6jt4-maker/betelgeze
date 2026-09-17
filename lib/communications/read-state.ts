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

export type ChatReadUpdate = ChatReadPosition & { kind: "client" | "native"; conversationId: string; userId: string; workspaceId: string }
const eventName = "betelgeze:chat-read"
const channelName = (workspaceId: string, userId: string) => `betelgeze:chat-read:${workspaceId}:${userId}`
function eventHost() { return window.top ?? window }

export function publishChatRead(update: ChatReadUpdate) {
    eventHost().dispatchEvent(new CustomEvent(eventName, { detail: update }))
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(channelName(update.workspaceId, update.userId))
    channel.postMessage(update)
    channel.close()
}

export function subscribeChatReads(workspaceId: string, userId: string, receive: (update: ChatReadUpdate) => void) {
    const accept = (value: unknown) => {
        const update = value as ChatReadUpdate | null
        if (update?.workspaceId !== workspaceId || update.userId !== userId
            || !["client", "native"].includes(update.kind) || typeof update.conversationId !== "string"
            || typeof update.lastReadAt !== "string" || !Number.isFinite(Date.parse(update.lastReadAt))
            || (update.lastReadMessageId !== null && typeof update.lastReadMessageId !== "string")) return
        receive(update)
    }
    const local = (event: Event) => accept((event as CustomEvent).detail)
    const host = eventHost()
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName(workspaceId, userId))
    if (channel) channel.onmessage = event => accept(event.data)
    host.addEventListener(eventName, local)
    return () => { host.removeEventListener(eventName, local); channel?.close() }
}
