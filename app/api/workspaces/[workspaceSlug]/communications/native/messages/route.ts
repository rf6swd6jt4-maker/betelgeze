import { nativeAttachmentFromInput, assertNativeConversationAccess, loadNativeMessageForCurrentUser, loadNativeMessagesForCurrentUser, loadNativeMessagePage } from "@/lib/teams/server"
import { communicationHistoryCursor } from "@/lib/communications/history-page"
import { deleteOnboardingUploads, inspectStoredCommunicationSticker, verifyNativeMessageUpload } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { after } from "next/server"
import { notifyNativeChatMessage } from "@/lib/push/chat-notifications"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { communicationFileKeyForCurrentUser } from "@/lib/communications/encryption"
import { NATIVE_MESSAGE_EDIT_WINDOW_MS } from "@/lib/teams/message-editing"
import { messageQuoteFromValue, messageQuoteMatches } from "@/lib/communications/message-quotes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const searchParams = new URL(request.url).searchParams
    const conversationId = searchParams.get("conversationId") ?? ""
    const messageId = searchParams.get("messageId") ?? ""
    if (!UUID_PATTERN.test(conversationId) || (messageId && !UUID_PATTERN.test(messageId))) return Response.json({ error: "A valid conversation is required." }, { status: 400 })
    if (!await assertNativeConversationAccess(conversationId, user.id, "read")) return Response.json({ error: "Conversation not found." }, { status: 404 })
    try {
        if (messageId) {
            const message = await loadNativeMessageForCurrentUser({ workspaceId: workspace.id, messageId })
            return message?.conversationId === conversationId
                ? Response.json({ message })
                : Response.json({ error: "Message not found." }, { status: 404 })
        }
        if (searchParams.has("beforeId") || searchParams.has("beforeCreatedAt")) {
            const cursor = communicationHistoryCursor({ id: searchParams.get("beforeId"), createdAt: searchParams.get("beforeCreatedAt") })
            if (!cursor) return Response.json({ error: "Invalid history cursor." }, { status: 400 })
            return Response.json(await loadNativeMessagePage(workspace.id, conversationId, cursor), { headers: { "Cache-Control": "no-store" } })
        }
        return Response.json({ messages: await loadNativeMessagesForCurrentUser({ workspaceId: workspace.id, conversationId, limit: 1000 }) }, { headers: { "Cache-Control": "no-store" } })
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not load messages." }, { status: 503 })
    }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null) as Record<string, unknown> | null
    if (input?.offlineWorkspaceId && input.offlineWorkspaceId !== workspace.id) return Response.json({ error: "This workspace is no longer available at this address." }, { status: 409 })
    if (input?.offlineUserId && input.offlineUserId !== user.id) return Response.json({ error: "Sign in with the account that wrote this message." }, { status: 409 })
    const conversationId = typeof input?.conversationId === "string" ? input.conversationId : ""
    const clientRequestId = typeof input?.clientRequestId === "string" ? input.clientRequestId : ""
    const replyToMessageId = typeof input?.replyToMessageId === "string" ? input.replyToMessageId : ""
    const body = typeof input?.body === "string" ? input.body.trim() : ""
    const attachment = nativeAttachmentFromInput(input?.attachment)
    const quote = messageQuoteFromValue(input?.quote)
    if (input?.quote != null && (!quote || !replyToMessageId)) return Response.json({ error: "A quote must contain selected text and an original message." }, { status: 400 })
    if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(clientRequestId) || (replyToMessageId && !UUID_PATTERN.test(replyToMessageId)) || (!body && !attachment) || body.length > 8000 || (input?.attachment && !attachment)) return Response.json({ error: "A valid message or attachment is required." }, { status: 400 })
    if (!await assertNativeConversationAccess(conversationId, user.id, "write")) return Response.json({ error: "Conversation is unavailable or read-only." }, { status: 403 })
    const existingRow = await supabaseAdmin
        .from("workspace_native_messages")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("conversation_id", conversationId)
        .eq("client_request_id", clientRequestId)
        .maybeSingle()
    if (existingRow.error) return Response.json({ error: `Could not check the message request: ${existingRow.error.message}` }, { status: 503 })
    if (existingRow.data) {
        try {
            const existing = await loadNativeMessageForCurrentUser({ workspaceId: workspace.id, messageId: existingRow.data.id })
            if (existing) return Response.json({ message: existing, reused: true })
            return Response.json({ error: "The earlier encrypted message attempt could not be recovered. Please send the message again." }, { status: 409 })
        } catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : "Could not recover the earlier message request." }, { status: 503 })
        }
    }
    if (replyToMessageId) {
        const { data: replyTarget } = await supabaseAdmin.from("workspace_native_messages").select("id").eq("workspace_id", workspace.id).eq("conversation_id", conversationId).eq("id", replyToMessageId).maybeSingle()
        if (!replyTarget) return Response.json({ error: "The replied message was not found." }, { status: 404 })
    }
    if (quote) {
        try {
            const original = await loadNativeMessageForCurrentUser({ workspaceId: workspace.id, messageId: replyToMessageId })
            if (!original || original.conversationId !== conversationId) return Response.json({ error: "The quoted message is unavailable." }, { status: 404 })
            if (!messageQuoteMatches(original.body, quote)) return Response.json({ error: "The quoted message changed. Select the text again." }, { status: 409 })
        } catch {
            return Response.json({ error: "Could not verify the quoted text. Try again." }, { status: 503 })
        }
    }
    let storedAttachment = attachment
    if (storedAttachment) {
        try {
            if (storedAttachment.kind === "sticker") {
                const { data: savedSticker } = await supabaseAdmin.from("communication_stickers").select("id").eq("workspace_id", workspace.id).eq("storage_path", storedAttachment.storagePath).maybeSingle()
                if (!savedSticker) throw new Error("Sticker not found in this workspace.")
                const verified = await inspectStoredCommunicationSticker({ workspaceId: workspace.id, storagePath: storedAttachment.storagePath, mimeType: storedAttachment.mimeType })
                storedAttachment = { ...storedAttachment, kind: "sticker", mimeType: verified.contentType, size: verified.size }
            } else {
                const verified = await verifyNativeMessageUpload({ workspaceId: workspace.id, conversationId, storagePath: storedAttachment.storagePath, mimeType: storedAttachment.mimeType, customerKey: await communicationFileKeyForCurrentUser(storedAttachment.storagePath) })
                storedAttachment = { ...storedAttachment, kind: verified.kind, mimeType: verified.contentType, size: verified.size }
            }
        } catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : "Could not verify attachment." }, { status: 400 })
        }
    }
    const { data, error } = await supabaseAdmin.from("workspace_native_messages").insert({ workspace_id: workspace.id, conversation_id: conversationId, sender_user_id: user.id, client_request_id: clientRequestId, body: body || null, reply_to_message_id: replyToMessageId || null, quote, attachment: storedAttachment }).select("id").single()
    if (error || !data) return Response.json({ error: error?.message ?? "Could not create message." }, { status: 503 })
    let message: Awaited<ReturnType<typeof loadNativeMessageForCurrentUser>> = null
    try {
        message = await loadNativeMessageForCurrentUser({ workspaceId: workspace.id, messageId: data.id })
    } catch (error) {
        return Response.json({ error: error instanceof Error ? `Message saved, but encrypted confirmation failed: ${error.message}` : "Message saved, but encrypted confirmation failed." }, { status: 503 })
    }
    if (!message) return Response.json({ error: "Message saved, but its encrypted copy could not be confirmed. Refresh the conversation before retrying." }, { status: 503 })
    if (message) after(() => notifyNativeChatMessage({
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        conversationId,
        messageId: message.id,
        senderUserId: user.id,
        previewBody: body,
        attachment: storedAttachment ? { kind: storedAttachment.kind, fileName: storedAttachment.fileName } : null,
    }))
    return Response.json({ message })
}

export async function PATCH(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null) as Record<string, unknown> | null
    const conversationId = typeof input?.conversationId === "string" ? input.conversationId : ""
    const messageId = typeof input?.messageId === "string" ? input.messageId : ""
    const body = typeof input?.body === "string" ? input.body.trim() : ""
    if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(messageId) || !body || body.length > 8000) return Response.json({ error: "A valid edited message is required." }, { status: 400 })
    if (!await assertNativeConversationAccess(conversationId, user.id, "write")) return Response.json({ error: "Conversation is unavailable or read-only." }, { status: 403 })

    const targetResult = await supabaseAdmin
        .from("workspace_native_messages")
        .select("id, sender_user_id, created_at")
        .eq("workspace_id", workspace.id)
        .eq("conversation_id", conversationId)
        .eq("id", messageId)
        .maybeSingle()
    if (targetResult.error) return Response.json({ error: targetResult.error.message }, { status: 503 })
    if (!targetResult.data) return Response.json({ error: "Message not found." }, { status: 404 })
    if (targetResult.data.sender_user_id !== user.id) return Response.json({ error: "You can only edit your own messages." }, { status: 403 })

    const editCutoff = new Date(Date.now() - NATIVE_MESSAGE_EDIT_WINDOW_MS).toISOString()
    const editedAt = new Date().toISOString()
    const updateResult = await supabaseAdmin
        .from("workspace_native_messages")
        .update({ body, edited_at: editedAt })
        .eq("workspace_id", workspace.id)
        .eq("conversation_id", conversationId)
        .eq("id", messageId)
        .eq("sender_user_id", user.id)
        .gte("created_at", editCutoff)
        .select("id")
        .maybeSingle()
    if (updateResult.error) return Response.json({ error: updateResult.error.message }, { status: 503 })
    if (!updateResult.data) return Response.json({ error: "Messages can only be edited for 15 minutes after sending." }, { status: 409 })

    try {
        const message = await loadNativeMessageForCurrentUser({ workspaceId: workspace.id, messageId })
        return message ? Response.json({ message }) : Response.json({ error: "The edited message could not be reloaded." }, { status: 503 })
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "The edited message could not be reloaded." }, { status: 503 })
    }
}

export async function DELETE(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const url = new URL(request.url)
    const conversationId = url.searchParams.get("conversationId") ?? ""
    const messageId = url.searchParams.get("messageId") ?? ""
    if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(messageId)) return Response.json({ error: "A valid message is required." }, { status: 400 })
    if (!await assertNativeConversationAccess(conversationId, user.id, "write")) return Response.json({ error: "Conversation is unavailable or read-only." }, { status: 403 })

    const supabase = await createSupabaseServerClient()
    const deletion = await supabase.rpc("delete_native_message_for_me", { p_conversation_id: conversationId, p_message_id: messageId })
    if (deletion.error) {
        const forbidden = deletion.error.message.includes("message_delete_forbidden")
        return Response.json({ error: forbidden ? "You cannot remove this member's message." : deletion.error.message }, { status: forbidden ? 403 : 503 })
    }
    const result = deletion.data && typeof deletion.data === "object" && !Array.isArray(deletion.data) ? deletion.data as Record<string, unknown> : {}
    const attachment = nativeAttachmentFromInput(result.attachment)
    if (attachment?.storagePath && attachment.kind !== "sticker") await deleteOnboardingUploads([attachment.storagePath]).catch(() => undefined)
    return Response.json({ deleted: true, conversationId, messageId })
}
