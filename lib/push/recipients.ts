import "server-only"
import { supabaseAdmin } from "@/lib/supabase/admin"

export function chatPushSchemaMissing(error: { code?: string } | null) {
    return error?.code === "PGRST202" || error?.code === "42883"
}

export async function nativeChatPushRecipients(workspaceId: string, conversationId: string) {
    const result = await supabaseAdmin.rpc("chat_push_recipients", { p_workspace: workspaceId, p_kind: "native", p_conversation: conversationId })
    if (!chatPushSchemaMissing(result.error)) return result
    // Equivalent membership filtering during the application-first rollout.
    const conversation = await supabaseAdmin.from("workspace_native_conversations").select("kind,team_id,direct_user_one,direct_user_two").eq("workspace_id", workspaceId).eq("id", conversationId).is("archived_at", null).maybeSingle()
    if (conversation.error || !conversation.data) return { data: [], error: conversation.error }
    const c = conversation.data
    if (c.kind === "team") {
        const team = await supabaseAdmin.from("workspace_teams").select("id").eq("workspace_id", workspaceId).eq("id", c.team_id).is("archived_at", null).maybeSingle()
        if (team.error || !team.data) return { data: [], error: team.error }
    }
    const [members, participants] = await Promise.all([
        supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspaceId),
        c.kind === "team"
            ? supabaseAdmin.from("workspace_team_members").select("user_id").eq("workspace_id", workspaceId).eq("team_id", c.team_id)
            : supabaseAdmin.from("workspace_native_conversation_participants").select("user_id").eq("workspace_id", workspaceId).eq("conversation_id", conversationId).in("user_id", [c.direct_user_one, c.direct_user_two].filter(Boolean)),
    ])
    if (members.error || participants.error) return { data: null, error: members.error ?? participants.error }
    const active = new Set((members.data ?? []).map(m => m.user_id))
    return { data: (participants.data ?? []).filter(p => active.has(p.user_id)), error: null }
}
