import { recordVersionKey } from "../record-version.js"

type ReadCursor = { lastReadMessageId: string | null; lastReadAt: string }
type MessagePosition = { id: string; createdAt: string }
type ClientUnreadConversation = { messages: Array<MessagePosition & { direction: "inbound" | "outbound" }> }
type NativeUnreadConversation = {
    messages: Array<MessagePosition & { senderUserId: string }>
    unreadMessages?: Array<MessagePosition & { senderUserId: string }>
}

function isAfterRead(message: MessagePosition, cursor: ReadCursor | undefined, readMessage: MessagePosition | undefined) {
    if (!cursor) return true
    // Older cursors may contain wall-clock read time. The actual message wins
    // whenever it is loaded; otherwise use the server's saved read-through time.
    const comparison = recordVersionKey(message.createdAt).localeCompare(recordVersionKey(readMessage?.createdAt ?? cursor.lastReadAt))
    return comparison > 0 || (comparison === 0 && Boolean(cursor.lastReadMessageId) && message.id > cursor.lastReadMessageId!)
}

export function clientConversationUnreadCount(conversation: ClientUnreadConversation, ownCursor: ReadCursor | undefined, _visiblyReading?: boolean) {
    void _visiblyReading // Older callers cannot bypass acknowledged read state.
    const readMessage = conversation.messages.find(message => message.id === ownCursor?.lastReadMessageId)
    return conversation.messages.filter(message => message.direction === "inbound" && isAfterRead(message, ownCursor, readMessage)).length
}

export function nativeConversationUnreadCount(conversation: NativeUnreadConversation, ownCursor: ReadCursor | undefined, currentUserId: string, _visiblyReading?: boolean) {
    void _visiblyReading
    // Merge compact unread identifiers and loaded history without fetching bodies.
    const messages = [...new Map([...(conversation.unreadMessages ?? []), ...conversation.messages].map(message => [message.id, message])).values()]
    const readMessage = messages.find(message => message.id === ownCursor?.lastReadMessageId)
    return messages.filter(message => message.senderUserId !== currentUserId && isAfterRead(message, ownCursor, readMessage)).length
}
