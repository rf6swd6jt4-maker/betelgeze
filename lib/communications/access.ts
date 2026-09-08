import "server-only"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function clientConversationCanAccess(workspaceId: string, relationshipId: string, userId: string) {
    const { data, error } = await supabaseAdmin.rpc("client_conversation_can_access", { p_workspace_id: workspaceId, p_relationship_id: relationshipId, p_user_id: userId })
    if (error) throw new Error("Could not verify conversation participation.")
    return data === true
}

export async function clientConversationRosters(workspaceId: string, userId: string) {
    const { data, error } = await supabaseAdmin.rpc("client_conversation_rosters", { p_workspace_id: workspaceId, p_user_id: userId })
    if (error) throw new Error("Could not load conversation participants.")
    return new Map((data as Array<{ relationship_id: string; manager_id: string | null; member_ids: string[]; optional_ids: string[]; eligible_ids: string[] }> ?? []).map((r) => [r.relationship_id, { managerId: r.manager_id, memberIds: r.member_ids, optionalIds: r.optional_ids, eligibleIds: r.eligible_ids }]))
}

export async function clientConversationParticipants(workspaceId: string, relationshipId: string) {
    const [relationship, extra, staff, members] = await Promise.all([
        supabaseAdmin.from("relationships").select("seller_user_id, fulfilment_manager_user_id").eq("workspace_id", workspaceId).eq("id", relationshipId).maybeSingle(),
        supabaseAdmin.from("relationship_client_chat_members").select("user_id").eq("workspace_id", workspaceId).eq("relationship_id", relationshipId),
        supabaseAdmin.from("relationship_services").select("assignee_user_id").eq("workspace_id", workspaceId).eq("relationship_id", relationshipId),
        supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspaceId),
    ])
    for (const result of [relationship, extra, staff, members]) if (result.error) throw new Error("Could not load conversation participants.")
    const active = new Set((members.data ?? []).map((m) => m.user_id))
    const baseIds = [relationship.data?.seller_user_id, relationship.data?.fulfilment_manager_user_id].filter((id): id is string => Boolean(id) && active.has(id))
    return {
        managerId: relationship.data?.fulfilment_manager_user_id ?? null,
        memberIds: [...new Set([...baseIds, ...(extra.data ?? []).map((m) => m.user_id)])].filter((id) => active.has(id)),
        optionalIds: (extra.data ?? []).map((m) => m.user_id).filter((id) => !baseIds.includes(id) && active.has(id)),
        eligibleIds: [...new Set((staff.data ?? []).flatMap((s) => s.assignee_user_id && !baseIds.includes(s.assignee_user_id) && active.has(s.assignee_user_id) ? [s.assignee_user_id] : []))],
    }
}
