import { requireWorkspacePanel } from "@/lib/workspace-access"
import { canAddSop } from "@/lib/sops/policy"
import { isSopId } from "@/lib/sops/records-policy"
import { listSopAssets } from "@/lib/sops/records"
import { sopTestRelationships, sopTestServices } from "@/lib/sops/work-server"
import { sopError, sopPrivateHeaders } from "@/lib/sops/http"
export const dynamic = "force-dynamic"
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string; id: string }> }) {
    const { workspaceSlug, id } = await context.params
    const { workspace, role } = await requireWorkspacePanel(workspaceSlug, "sops")
    if (!canAddSop(role)) return Response.json({ error: "Only admins can run this pilot." }, { status: 403, headers: sopPrivateHeaders })
    if (!isSopId(id)) return Response.json({ error: "Not found." }, { status: 404, headers: sopPrivateHeaders })
    const query = new URL(request.url).searchParams
    try {
        const relationshipId = query.get("relationshipId")
        if (relationshipId) {
            if (!isSopId(relationshipId)) throw new Error("Choose a valid test relationship.")
            return Response.json({ services: await sopTestServices(workspace.id, relationshipId) }, { headers: sopPrivateHeaders })
        }
        const cursor = query.get("cursor") ?? undefined
        return Response.json(query.get("kind") === "assets" ? await listSopAssets(workspace.id, id, cursor) : await sopTestRelationships(workspace.id, cursor), { headers: sopPrivateHeaders })
    } catch (error) { return sopError(error, "Could not load pilot options.") }
}
