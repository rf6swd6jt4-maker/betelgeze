import { after } from "next/server"
import { processChatPushDeliveries } from "@/lib/push/delivery"
import { clientConversationCanAccess } from "@/lib/communications/access"
import { getCurrentUser } from "@/lib/workspaces"
import { assertNativeConversationAccess } from "@/lib/teams/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { UUID_PATTERN } from "@/lib/push/device"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
    const receivedAt = new Date().toISOString()
    const user = await getCurrentUser()
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 })
    const input = await request.json().catch(() => null) as { tabId?: unknown; active?: unknown; workspaceId?: unknown; conversationId?: unknown; conversationKind?: unknown; connectionLive?: unknown; revision?: unknown; transition?: unknown } | null
    const tabId = typeof input?.tabId === "string" ? input.tabId : ""
    if (!UUID_PATTERN.test(tabId) || typeof input?.active !== "boolean") return Response.json({ error: "Invalid activity session." }, { status: 400 })

    // Old mounted clients cannot reintroduce unsequenced suppression. They
    // keep receiving notifications until their next reload.
    const revision = input.revision
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) return Response.json({ active: false, refreshRequired: true })
    const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId : ""
    const conversationId = typeof input.conversationId === "string" ? input.conversationId : ""
    const conversationKind = input.conversationKind === "client" || input.conversationKind === "native" ? input.conversationKind : null
    if (input.active && (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(conversationId) || !conversationKind || input.connectionLive !== true)) return Response.json({ error: "Invalid active conversation." }, { status: 400 })
    if (input.active) {
        const { data: membership } = await supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle()
        if (!membership) return Response.json({ error: "Workspace not found." }, { status: 404 })
        const canRead = conversationKind === "client"
            ? await clientConversationCanAccess(workspaceId, conversationId, user.id)
            : Boolean(await assertNativeConversationAccess(conversationId, user.id, "read"))
        if (!canRead) return Response.json({ error: "Conversation not found." }, { status: 404 })
    }
    const { data: changed, error } = await supabaseAdmin.rpc("record_chat_activity", {
        p_user: user.id, p_tab: tabId, p_revision: revision, p_active: input.active,
        p_workspace: UUID_PATTERN.test(workspaceId) ? workspaceId : null,
        p_kind: conversationKind, p_conversation: UUID_PATTERN.test(conversationId) ? conversationId : null,
        p_seen_at: receivedAt,
    })
    if (error) return Response.json({ error: "Could not update the activity session." }, { status: 503 })
    if (changed && input.transition === true) after(async () => {
        try {
            const wake = await supabaseAdmin.rpc("wake_chat_push_for_user", { p_user: user.id })
            if (wake.error) throw wake.error
            await processChatPushDeliveries({ userId: user.id, limit: 50 })
        } catch { console.warn("Chat activity changed; notification recovery remains scheduled") }
    })
    return Response.json({ active: input.active, revision, applied: changed === true })
}
