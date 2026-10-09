import { requireWorkspacePanel } from "@/lib/workspace-access"
import { loadClientCalendars } from "@/lib/client-connections"
import { readGhlJson } from "@/lib/client-portal/ghl-provider"

export async function POST(request: Request, { params }: { params: Promise<{ workspaceSlug: string }> }) {
    const headers = { "Cache-Control": "private, no-store" }
    try {
        if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Use Client Connections to load calendars." }, { status: 403, headers })
        if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Expected JSON." }, { status: 415, headers })
        const { workspaceSlug } = await params
        const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "client-connections")
        const body = await readGhlJson(new Response(request.body), 8192)
        if (typeof body.relationshipId !== "string" || typeof body.locationId !== "string" || typeof body.privateToken !== "string" || (body.expectedRevision !== null && typeof body.expectedRevision !== "string")) throw new Error("Invalid connection details.")
        const calendars = await loadClientCalendars(workspace.id, user.id, { relationshipId: body.relationshipId, locationId: body.locationId, privateToken: body.privateToken, expectedRevision: body.expectedRevision })
        return Response.json({ calendars }, { headers })
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Calendars could not be loaded." }, { status: 400, headers }) }
}
