import { recordVersionKey } from "../record-version.js"

type Reaction = { id: string; messageId: string; updatedAt: string }
type Conversation = {
    id: string
    latestMessageAt?: string | null
    previewMessage?: { createdAt: string } | null
    messages: Array<{ createdAt: string }>
    updatedAt?: string
}

export function indexChatReactions<R extends Reaction>(reactions: R[], conversationId: (reaction: R) => string) {
    const byMessage = new Map<string, R[]>()
    const latestByConversation = new Map<string, { reaction: R; time: string }>()
    for (const reaction of reactions) {
        const group = byMessage.get(reaction.messageId)
        if (group) group.push(reaction)
        else byMessage.set(reaction.messageId, [reaction])
        const id = conversationId(reaction)
        const previous = latestByConversation.get(id)
        const time = recordVersionKey(reaction.updatedAt)
        if (!previous || time > previous.time || (time === previous.time && reaction.id > previous.reaction.id)) {
            latestByConversation.set(id, { reaction, time })
        }
    }
    return { byMessage, latestByConversation }
}

export function conversationInbox<C extends Conversation, R extends Reaction>(conversations: C[], latest: Map<string, { reaction: R; time: string }>) {
    let hasReactionPreview = false
    const rows = conversations.map(conversation => {
        const messageAt = conversation.latestMessageAt ?? conversation.previewMessage?.createdAt ?? conversation.messages.at(-1)?.createdAt
        const candidate = latest.get(conversation.id)
        const messageTime = messageAt ? recordVersionKey(messageAt) : ""
        if (candidate && candidate.time >= messageTime) {
            hasReactionPreview = true
            return { conversation, reaction: candidate.reaction, activityAt: candidate.reaction.updatedAt, order: candidate.time }
        }
        return { conversation, reaction: null, activityAt: messageAt, order: messageTime || recordVersionKey(conversation.updatedAt ?? "") }
    })
    return hasReactionPreview ? rows.sort((a, b) => b.order.localeCompare(a.order)) : rows
}

export function reactionPreviewText(actor: string, emoji: string, targetPreview?: string) {
    return targetPreview ? `${actor} reacted ${emoji} to “${targetPreview}”` : `${actor} reacted ${emoji} to a message`
}
