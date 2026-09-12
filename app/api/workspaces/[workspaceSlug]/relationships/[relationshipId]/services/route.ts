import { unstable_rethrow } from "next/navigation"
import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { readRelationshipServices } from "@/lib/relationship-services-server"

export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }
export async function GET(request: Request, context: { params: Promise<{workspaceSlug: string; relationshipId: string}> }) {
    const { workspaceSlug, relationshipId } = await context.params
    const { workspace, user, access } = await requireWorkspacePanel(workspaceSlug, "relationships")
    await requireRelationshipAccess(access, relationshipId)
    const query = new URL(request.url).searchParams
    const offset = Number(query.get("offset") ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return Response.json({ error: "Invalid page" }, { status: 400, headers })
    try {
        const kind = query.get("kind")
        if (!kind) return Response.json(await readRelationshipServices(workspace.id, relationshipId, user.id, offset), { headers })
        const parameters = { p_workspace_id: workspace.id, p_user_id: user.id }
        const result = kind === "catalogue" ? await supabaseAdmin.rpc("relationship_service_catalogue", { ...parameters, p_query: (query.get("q") ?? "").slice(0, 100), p_offset: offset })
            : kind === "assignees" ? await supabaseAdmin.rpc("relationship_service_assignees", { ...parameters, p_relationship_id: relationshipId, p_service_id: query.get("service") })
            : ["work", "history"].includes(kind) ? await supabaseAdmin.rpc("relationship_service_activity", { ...parameters, p_relationship_id: relationshipId, p_kind: kind, p_offset: offset }) : null
        if (!result) return Response.json({ error: "Unknown section" }, { status: 400, headers })
        if (result.error) return Response.json({ error: "This section could not be loaded. Check your access and retry." }, { status: 400, headers })
        const data = kind === "catalogue" ? { items: result.data.slice(0, 30), hasMore: result.data.length > 30 } : kind === "assignees" ? result.data : { ...result.data, items: result.data.items.slice(0, 30) }
        return Response.json(data, { headers })
    } catch (error) {
        unstable_rethrow(error)
        return Response.json({ error: "Could not load this section. Try again." }, { status: 503, headers })
    }
}
