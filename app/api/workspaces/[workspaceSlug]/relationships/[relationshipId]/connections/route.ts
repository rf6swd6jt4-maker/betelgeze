import { readCurrentClientConnections } from "@/lib/client-connections"
import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { listWorkspaceConnections } from "@/lib/workspace-integrations"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const headers = { "Cache-Control": "private, no-store" }

/**
 * The Connections section of one client's page (Today layout): that client's connections and the agency connection's
 * state. Read-only. It makes the same two reads as the Client Connections page narrowed to a relationship, behind the
 * same panel check, and adds the relationship access check. Nothing here calls a provider.
 */
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string; relationshipId: string }> }) {
    const { workspaceSlug, relationshipId } = await context.params
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(relationshipId)) return Response.json({ error: "Invalid client." }, { status: 400, headers })
    const { workspace, user, role, access } = await requireWorkspacePanel(workspaceSlug, "client-connections")
    if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your account changed. Reload the page." }, { status: 409, headers })
    await requireRelationshipAccess(access, relationshipId)
    try {
        const [accounts, connections] = await Promise.all([
            readCurrentClientConnections(workspace.id, user.id, relationshipId),
            listWorkspaceConnections(workspace.id),
        ])
        const highLevel = connections.find((connection) => connection.provider === "ghl")
        return Response.json({
            userId: user.id, relationshipId, accounts,
            agency: { connected: Boolean(highLevel?.enabled), name: typeof highLevel?.config_hint.company_name === "string" ? highLevel.config_hint.company_name : null, id: typeof highLevel?.config_hint.company_id === "string" ? highLevel.config_hint.company_id : null },
            canManageAgency: role === "owner" || role === "admin",
        }, { headers })
    } catch {
        return Response.json({ error: "Connections could not be loaded." }, { status: 503, headers })
    }
}
