import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ workspaceSlug: string; relationshipId: string }> }) {
    const { workspaceSlug, relationshipId } = await context.params
    if (!/^[0-9a-f-]{36}$/i.test(relationshipId)) return Response.json({ error: "Invalid relationship." }, { status: 400 })
    const { workspace, access } = await requireWorkspacePanel(workspaceSlug, "relationships")
    await requireRelationshipAccess(access, relationshipId)
    const { data, error } = await supabaseAdmin.rpc("read_relationship_engagement", {
        p_workspace_id: workspace.id,
        p_relationship_id: relationshipId,
    })
    if (error) return Response.json({ error: "Could not load engagement metrics." }, { status: 503 })
    if (!data) return Response.json({ error: "Relationship not found." }, { status: 404 })
    return Response.json({ engagement: data }, { headers: { "Cache-Control": "no-store" } })
}
