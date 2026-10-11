import { communicationDeviceId, deviceReadError, validateCommunicationReadProtocol } from "@/lib/communications/device-server"
import { withChatPerformance } from "@/lib/communications/performance-server"
import { after } from "next/server"
import { clearReadChatPushNotifications } from "@/lib/push/chat-notifications"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireCommunicationsReadWorkspace } from "@/lib/communications/workspace-access"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function handlePOST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const supabase = await createSupabaseServerClient()
    const { workspace, user } = await requireCommunicationsReadWorkspace(workspaceSlug, supabase)
    const readProtocol = validateCommunicationReadProtocol(request, workspace.id, user.id)
    if (readProtocol instanceof Response) return readProtocol
    const input = await request.json().catch(() => null) as Record<string, unknown> | null
    const conversationId = typeof input?.conversationId === "string" ? input.conversationId : ""
    const messageId = typeof input?.messageId === "string" ? input.messageId : ""
    if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(messageId)) return Response.json({ error: "Conversation not found." }, { status: 404 })
    if (readProtocol === "device-v1") {
        const deviceId = await communicationDeviceId()
        if (!deviceId) return deviceReadError({ code: "P0002" })
        if (input?.deviceId !== deviceId) return Response.json({ error: "The current device changed. Refresh unread counts and retry.", code: "device_changed", readProtocol }, { status: 409 })
        const { data, error } = await supabase.rpc("advance_communication_device_read", { p_workspace_id: workspace.id, p_device_id: deviceId, p_kind: "native", p_conversation_id: conversationId, p_message_id: messageId })
        if (error || !data || data.deviceId !== deviceId) return deviceReadError(error)
        after(async () => {
            try { await clearReadChatPushNotifications({ userId: user.id, conversationKind: "native", conversationId: conversationId, readThroughCreatedAt: data.cursor.lastReadAt }) }
            catch { console.warn("Confirmed chat read; legacy notification cleanup remains pending") }
        })
        return Response.json({ ...data, readProtocol, cursor: { ...data.cursor, conversationId }, notificationReadThrough: data.cursor.lastReadAt }, { headers: { "Cache-Control": "private, no-store" } })
    }
    const { data: position, error } = await supabase.rpc("advance_communication_read", { p_workspace_id: workspace.id, p_kind: "native", p_conversation_id: conversationId, p_message_id: messageId })
    // The atomic RPC checks MFA, membership, conversation access and message scope.
    if (error?.code === "42501") return Response.json({ error: "Conversation not found." }, { status: 404 })
    if (error || !position) return Response.json({ error: "Could not save the read position." }, { status: 503 })
    after(async () => {
        try { await clearReadChatPushNotifications({ userId: user.id, conversationKind: "native", conversationId: conversationId, readThroughCreatedAt: position.lastReadAt }) }
        catch { console.warn("Confirmed chat read; legacy notification cleanup remains pending") }
    })
    return Response.json({ readProtocol, cursor: { ...position, conversationId }, notificationReadThrough: position.lastReadAt })
}

export const POST = withChatPerformance("message.read", handlePOST)
