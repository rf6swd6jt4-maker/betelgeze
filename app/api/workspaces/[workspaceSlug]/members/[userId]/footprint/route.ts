import { loadMemberFootprint } from "@/lib/staff-server"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const headers = { "Cache-Control": "private, no-store" }

/** Everything a member can hand over, for the reassign dialogs. Owners and admins only; read-only. */
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string; userId: string }> }) {
    const { workspaceSlug, userId } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your account changed. Reload the page." }, { status: 409, headers })
    if (!UUID_PATTERN.test(userId)) return Response.json({ error: "Person not found." }, { status: 404, headers })
    try {
        // Until the migration is applied, this reports { available: false } and the dialog falls back to plain removal.
        return Response.json(await loadMemberFootprint(workspace.id, user.id, userId), { headers })
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not load this person's assignments." }, { status: 503, headers })
    }
}
