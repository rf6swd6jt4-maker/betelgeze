import { requireWorkspacePanel } from "@/lib/workspace-access"
import { readClientConnections } from "@/lib/client-connections"

export async function GET(request: Request, { params }: { params: Promise<{ workspaceSlug: string }> }) {
    const headers = { "Cache-Control": "private, no-store" }
    try {
        const { workspaceSlug } = await params
        const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "client-connections")
        const query = new URL(request.url).searchParams
        const before = query.get("before"), id = query.get("id"), relationship = query.get("relationship")
        const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
        if (!before || !Number.isFinite(Date.parse(before)) || !id || !uuid.test(id) || (relationship && !uuid.test(relationship))) return Response.json({ error: "Invalid history cursor." }, { status: 400, headers })
        const page = await readClientConnections(workspace.id, user.id, relationship ?? undefined, { before, id })
        return Response.json(page, { headers })
    } catch { return Response.json({ error: "Connection history could not be loaded." }, { status: 400, headers }) }
}
