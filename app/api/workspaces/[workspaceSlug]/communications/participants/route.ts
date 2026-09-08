import { requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { clientConversationParticipants } from "@/lib/communications/access"
export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null)
    if (!/^[0-9a-f-]{36}$/i.test(input?.relationshipId ?? "") || !Array.isArray(input?.userIds) || input.userIds.some((id: unknown) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) return Response.json({ error: "Invalid participants." }, { status: 400 })
    const { error } = await supabaseAdmin.rpc("set_client_chat_members", { p_workspace_id: workspace.id, p_relationship_id: input.relationshipId, p_actor_user_id: user.id, p_user_ids: input.userIds })
    if (error) return Response.json({ error: error.message }, { status: 403 })
    return Response.json(await clientConversationParticipants(workspace.id, input.relationshipId))
}
