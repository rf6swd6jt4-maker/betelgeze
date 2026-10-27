import { requireWorkspacePanel } from "@/lib/workspace-access"
import { ClientConnectionRelationshipsAccessError, readClientConnectionRelationships, type ClientConnectionProvider } from "@/lib/client-connection-relationships"

export async function GET(request: Request, { params }: { params: Promise<{ workspaceSlug: string }> }) {
    const headers = { "Cache-Control": "private, no-store" }
    try {
        const { workspaceSlug } = await params
        const authorization = await requireWorkspacePanel(workspaceSlug, "client-connections").catch(() => null)
        if (!authorization) return Response.json({ error: "Client connection access changed." }, { status: 403, headers })
        const paramsQuery = new URL(request.url).searchParams
        const provider = paramsQuery.get("provider"), query = paramsQuery.get("query") ?? "", after = paramsQuery.get("after"), relationship = paramsQuery.get("relationship")
        const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
        if (!provider || !["ghl", "meta_ads", "google_ads"].includes(provider) || query.length > 100
            || (after !== null && !uuid.test(after)) || (relationship !== null && !uuid.test(relationship))) {
            return Response.json({ error: "Invalid relationship search." }, { status: 400, headers })
        }
        const page = await readClientConnectionRelationships(authorization.workspace.id, authorization.user.id, provider as ClientConnectionProvider, query, after ?? undefined, relationship ?? undefined)
        return Response.json(page, { headers })
    } catch (error) {
        return Response.json({ error: "Relationships could not be loaded. Try again." }, { status: error instanceof ClientConnectionRelationshipsAccessError ? 403 : 400, headers })
    }
}
