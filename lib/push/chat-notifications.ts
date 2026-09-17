import "server-only"
import { mentionedRecipients, mentionPreview } from "@/lib/chat-formatting"
import { clientConversationParticipants } from "@/lib/communications/access"

import { supabaseAdmin } from "@/lib/supabase/admin"
import { deliverChatPush } from "@/lib/push/delivery"
import { nativeChatPushRecipients } from "@/lib/push/recipients"

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
    const [
        { data: participants, error: participantsError },
        { data: profile, error: profileError },
        { data: conversation, error: conversationError },
        { data: message, error: messageError },
    ] = await Promise.all([
        nativeChatPushRecipients(input.workspaceId, input.conversationId),
        supabaseAdmin.from("user_profiles").select("display_name, username").eq("user_id", input.senderUserId).maybeSingle(),
        supabaseAdmin.from("workspace_native_conversations").select("kind, team_id").eq("workspace_id", input.workspaceId).eq("id", input.conversationId).maybeSingle(),
        supabaseAdmin.from("workspace_native_messages").select("created_at").eq("workspace_id", input.workspaceId).eq("conversation_id", input.conversationId).eq("id", input.messageId).maybeSingle(),
    ])
    if (participantsError || profileError || conversationError || messageError || !conversation || !message) {
        console.error("Could not prepare native chat push", participantsError ?? profileError ?? conversationError ?? messageError)
        return
    }
    const senderName = profile?.display_name?.trim() || profile?.username || "A workspace member"
    let chatName = senderName
    if (conversation.kind === "team" && conversation.team_id) {
        const { data: team, error: teamError } = await supabaseAdmin.from("workspace_teams").select("name").eq("workspace_id", input.workspaceId).eq("id", conversation.team_id).maybeSingle()
        if (teamError) {
            console.error("Could not resolve native chat name", teamError)
            return
        }
        chatName = team?.name?.trim() || "Team chat"
    }
    const notification = chatNotificationText(chatName, mentionPreview(input.previewBody), input.attachment)
    const mentionUserIds = conversation.kind === "team" ? mentionedRecipients(input.previewBody, (participants ?? []).map((participant: { user_id: string }) => participant.user_id), input.senderUserId) : []
    await deliverChatPush(
        (participants ?? []).map((participant: { user_id: string }) => participant.user_id).filter((userId: string) => userId !== input.senderUserId),
        {
            workspaceId: input.workspaceId,
            conversationKind: "native",
            messageId: input.messageId,
            messageCreatedAt: message.created_at,
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
    const [
        { data: workspace, error: workspaceError },
        { data: relationship, error: relationshipError },
        { data: message, error: messageError },
    ] = await Promise.all([
        supabaseAdmin.from("workspaces").select("slug").eq("id", input.workspaceId).single(),
        supabaseAdmin.from("relationships").select("primary_person_name, business_name").eq("workspace_id", input.workspaceId).eq("id", input.relationshipId).maybeSingle(),
        supabaseAdmin.from("client_messages").select("created_at").eq("workspace_id", input.workspaceId).eq("relationship_id", input.relationshipId).eq("id", input.messageId).maybeSingle(),
    ])
    if (workspaceError || relationshipError || messageError || !workspace || !message) {
        console.error("Could not prepare client chat push", workspaceError ?? relationshipError ?? messageError)
        return
    }
    const primaryName = relationship?.primary_person_name?.trim() || input.senderName
    const businessName = relationship?.business_name?.trim()
    const notification = chatNotificationText(businessName ? `${primaryName} – ${businessName}` : primaryName, input.previewBody, input.attachment)
    const participants = await clientConversationParticipants(input.workspaceId, input.relationshipId)
    await deliverChatPush(participants.memberIds, {
        workspaceId: input.workspaceId,
        conversationKind: "client",
        messageId: input.messageId,
        messageCreatedAt: message.created_at,
        conversationId: input.relationshipId,
        title: notification.title,
        body: notification.body,
        url: `/${encodeURIComponent(workspace.slug)}/communications?conversation=${encodeURIComponent(input.relationshipId)}`,
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
