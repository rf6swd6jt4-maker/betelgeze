import { beginChatServerMeasurement } from "@/lib/communications/performance-server"
import "server-only"
import { mentionedRecipients, mentionPreview } from "@/lib/chat-formatting"

import { supabaseAdmin } from "@/lib/supabase/admin"
import { deliverChatPush } from "@/lib/push/delivery"

type ChatPushAttachment = {
    kind?: unknown
    fileName?: unknown
}

export function webPushPublicKey() {
    return process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() || null
}

function notificationLine(value: unknown, limit: number) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : ""
}

function attachmentMessage(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return ""
    const attachment = value as Record<string, unknown>
    const kind = notificationLine(attachment.kind, 24)
    const fileName = notificationLine(attachment.fileName, 100)
    const label = kind === "image" ? "Photo" : kind === "video" ? "Video" : kind === "audio" ? "Voice note" : kind === "sticker" ? "Sticker" : kind === "document" ? "File" : ""
    return label ? (label === "File" && fileName ? `${label}: ${fileName}` : label) : ""
}

export function chatNotificationText(chatName: string, messageBody: unknown, attachment?: unknown) {
    return {
        title: notificationLine(chatName, 80) || "Betelgeze chat",
        body: notificationLine(messageBody, 240) || attachmentMessage(attachment) || "New message",
    }
}

export async function clearReadChatPushNotifications(input: {
    userId: string
    conversationKind: "client" | "native"
    conversationId: string
    readThroughCreatedAt: string
}) {
    const { error } = await supabaseAdmin.rpc("clear_read_chat_push_notifications", {
        p_user_id: input.userId,
        p_conversation_kind: input.conversationKind,
        p_conversation_id: input.conversationId,
        p_read_through: input.readThroughCreatedAt,
    })
    if (error) throw new Error(`Could not clear the chat notification state: ${error.message}`)
}

export async function notifyNativeChatMessage(input: {
    workspaceId: string
    workspaceSlug: string
    conversationId: string
    messageId: string
    senderUserId: string
    previewBody: string
    attachment?: ChatPushAttachment | null
}) {
    const timing = beginChatServerMeasurement("message.push.context")
    const { data: context, error } = await supabaseAdmin.rpc("chat_push_context", {
        p_workspace: input.workspaceId, p_kind: "native", p_conversation: input.conversationId, p_message: input.messageId,
    })
    if (!error && context) timing.mark("data_ready")
    console.info("Chat performance", timing.finish(error || !context ? "failed" : "completed", error || !context ? undefined : "data_ready"))
    if (error || !context) { console.warn("Could not prepare native chat push"); return }
    const senderName = context.senderName as string
    const chatName = context.conversationKind === "team" ? context.teamName?.trim() || "Team chat" : senderName
    const recipients = context.recipients as string[]
    const notification = chatNotificationText(chatName, mentionPreview(input.previewBody), input.attachment)
    const mentionUserIds = context.conversationKind === "team" ? mentionedRecipients(input.previewBody, recipients, input.senderUserId) : []
    await deliverChatPush(
        recipients.filter(userId => userId !== input.senderUserId),
        {
            workspaceId: input.workspaceId,
            conversationKind: "native",
            messageId: input.messageId,
            messageCreatedAt: context.messageCreatedAt,
            conversationId: input.conversationId,
            mentionUserIds,
            mentionBody: `${notificationLine(senderName, 80)} mentioned you in ${notificationLine(chatName, 80)} group chat`,
            title: notification.title,
            body: notification.body,
            url: `/${encodeURIComponent(input.workspaceSlug)}/communications?mode=team&nativeConversation=${encodeURIComponent(input.conversationId)}`,
        },
    )
}

export async function notifyClientChatMessage(input: {
    workspaceId: string
    relationshipId: string
    messageId: string
    senderName: string
    previewBody: string
    attachment?: ChatPushAttachment | null
}) {
    const timing = beginChatServerMeasurement("message.push.context")
    const { data: context, error } = await supabaseAdmin.rpc("chat_push_context", {
        p_workspace: input.workspaceId, p_kind: "client", p_conversation: input.relationshipId, p_message: input.messageId,
    })
    if (!error && context) timing.mark("data_ready")
    console.info("Chat performance", timing.finish(error || !context ? "failed" : "completed", error || !context ? undefined : "data_ready"))
    if (error || !context) { console.warn("Could not prepare client chat push"); return }
    const primaryName = context.primaryName?.trim() || input.senderName
    const businessName = context.businessName?.trim()
    const notification = chatNotificationText(businessName ? `${primaryName} – ${businessName}` : primaryName, input.previewBody, input.attachment)
    await deliverChatPush(context.recipients, {
        workspaceId: input.workspaceId,
        conversationKind: "client",
        messageId: input.messageId,
        messageCreatedAt: context.messageCreatedAt,
        conversationId: input.relationshipId,
        title: notification.title,
        body: notification.body,
        url: `/${encodeURIComponent(context.workspaceSlug)}/communications?conversation=${encodeURIComponent(input.relationshipId)}`,
    })
}

/** Internal dispute notification: recipient and destination come only from the saved dispute. */
export async function notifyQueueDispute(input:{workspaceId:string;disputeId:string}) {
    const result=await supabaseAdmin.from('work_queue_disputes').select('resolver_id,conversation_id,message_id').eq('workspace_id',input.workspaceId).eq('id',input.disputeId).single()
    if(result.error)throw new Error('Dispute notification unavailable')
    const d=result.data
    const [conversation,workspace,message,access]=await Promise.all([
        supabaseAdmin.from('workspace_native_conversations').select('team_id,kind').eq('workspace_id',input.workspaceId).eq('id',d.conversation_id).single(),
        supabaseAdmin.from('workspaces').select('slug').eq('id',input.workspaceId).single(),
        supabaseAdmin.from('workspace_native_messages').select('created_at').eq('workspace_id',input.workspaceId).eq('conversation_id',d.conversation_id).eq('id',d.message_id).single(),
        supabaseAdmin.rpc('queue_feedback_can_review',{p_workspace:input.workspaceId,p_dispute:input.disputeId,p_user:d.resolver_id}),
    ])
    if(conversation.error||workspace.error||message.error||access.error)throw new Error('Dispute notification routing unavailable')
    if(conversation.data.kind!=='team'||!access.data)return
    const team=await supabaseAdmin.from('workspace_teams').select('name').eq('workspace_id',input.workspaceId).eq('id',conversation.data.team_id).is('archived_at',null).single()
    if(team.error)throw new Error('Dispute team unavailable')
    await deliverChatPush([d.resolver_id],{workspaceId:input.workspaceId,conversationKind:'native',messageId:d.message_id,messageCreatedAt:message.data.created_at,conversationId:d.conversation_id,title:`Dispute in ${team.data.name}`,body:'A work item needs your review.',url:`/${workspace.data.slug}/communications?conversation=${encodeURIComponent(d.conversation_id)}`})
}
