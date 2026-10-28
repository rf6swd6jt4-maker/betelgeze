import { requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
const headers = { "Cache-Control": "private, no-store" }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const teamId = new URL(request.url).searchParams.get("teamId") ?? ""
    if (!uuid.test(teamId)) return Response.json({ error: "Invalid team." }, { status: 400, headers })
    const { data, error } = await supabaseAdmin.rpc("read_team_client_chat_members", { p_workspace_id: workspace.id, p_team_id: teamId, p_actor_user_id: user.id })
    if (error) return Response.json({ error: error.message }, { status: 403, headers })
    return Response.json(data, { headers })
}

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null)
    if (input?.operation === "addFromTeam") {
        if (typeof input.teamId !== "string" || !uuid.test(input.teamId) || !Array.isArray(input.userIds) || input.userIds.length < 1 || input.userIds.length > 200 || input.userIds.some((id: unknown) => typeof id !== "string" || !uuid.test(id))) return Response.json({ error: "Invalid team members." }, { status: 400, headers })
        const { data, error } = await supabaseAdmin.rpc("add_team_client_chat_members", { p_workspace_id: workspace.id, p_team_id: input.teamId, p_actor_user_id: user.id, p_user_ids: input.userIds })
        if (error) return Response.json({ error: error.message }, { status: error.code === "22023" ? 400 : 403, headers })
        return Response.json(data, { headers })
    }
    if (!/^[0-9a-f-]{36}$/i.test(input?.relationshipId ?? "") || !Array.isArray(input?.userIds) || input.userIds.some((id: unknown) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) return Response.json({ error: "Invalid participants." }, { status: 400 })
    const { error } = await supabaseAdmin.rpc("set_client_chat_members", { p_workspace_id: workspace.id, p_relationship_id: input.relationshipId, p_actor_user_id: user.id, p_user_ids: input.userIds })
    if (error) return Response.json({ error: error.message }, { status: 403 })
    // The Client editor consumes only the acknowledgement, then refreshes via
    // its existing synchronize owner. Avoid four discarded roster reads here.
    return Response.json({ ok: true }, { headers })
}
