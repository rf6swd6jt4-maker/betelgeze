import { requireWorkspacePanel } from "@/lib/workspace-access"
import { readClientAdvertisingConnections, AdvertisingConnectionAccessError, type AdvertisingProvider } from "@/lib/client-advertising-connections"

export async function GET(request: Request, { params }: { params: Promise<{ workspaceSlug: string }> }) {
    const headers = { "Cache-Control": "private, no-store" }
    try {
        const { workspaceSlug } = await params
        const authorization = await requireWorkspacePanel(workspaceSlug, "client-connections").catch(() => null)
        if (!authorization) return Response.json({ error: "Client connection access changed." }, { status: 403, headers })
        const { workspace, user } = authorization
        const query = new URL(request.url).searchParams
        const relationship = query.get("relationship"), after = query.get("after"), provider = query.get("provider")
        const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
        if ((relationship !== null && !uuid.test(relationship)) || (after === null) !== (provider === null)
            || (after !== null && !uuid.test(after)) || (provider !== null && !["google_ads", "meta_ads", "windsor"].includes(provider))) {
            return Response.json({ error: "Invalid connection cursor." }, { status: 400, headers })
        }
        const page = await readClientAdvertisingConnections(workspace.id, user.id, relationship ?? undefined,
            after && provider ? { relationshipId: after, provider: provider as AdvertisingProvider } : undefined)
        return Response.json(page, { headers })
    } catch (error) { return Response.json({ error: "Advertising connections could not be loaded. Try again." }, { status: error instanceof AdvertisingConnectionAccessError ? 403 : 400, headers }) }
}
