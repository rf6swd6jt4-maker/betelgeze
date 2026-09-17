import { assertNativeConversationAccess } from "@/lib/teams/server"
import { clearReadChatPushNotifications } from "@/lib/push/chat-notifications"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null) as Record<string, unknown> | null
    const conversationId = typeof input?.conversationId === "string" ? input.conversationId : ""
    const messageId = typeof input?.messageId === "string" ? input.messageId : ""
    if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(messageId) || !await assertNativeConversationAccess(conversationId, user.id, "read")) return Response.json({ error: "Conversation not found." }, { status: 404 })
    const supabase = await createSupabaseServerClient()
    const { data: position, error } = await supabase.rpc("advance_communication_read", { p_workspace_id: workspace.id, p_kind: "native", p_conversation_id: conversationId, p_message_id: messageId })
    if (error || !position) return Response.json({ error: "Could not save the read position." }, { status: 503 })
    await clearReadChatPushNotifications({ userId: user.id, conversationKind: "native", conversationId: conversationId, readThroughCreatedAt: position.lastReadAt })
    return Response.json({ cursor: { ...position, conversationId }, notificationReadThrough: position.lastReadAt })
}
