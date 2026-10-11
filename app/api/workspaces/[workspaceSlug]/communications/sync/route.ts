import { deviceCommunicationErrorResponse, validateCommunicationReadProtocol } from "@/lib/communications/device-server"
import { loadClientCommunicationsBootstrap } from "@/lib/communications/bootstrap"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const readProtocol = validateCommunicationReadProtocol(request, workspace.id, user.id)
    if (readProtocol instanceof Response) return readProtocol
    try {
    const bootstrap = await loadClientCommunicationsBootstrap({
        readProtocol,
        currentUserId: user.id,
        requestedConversationId: new URL(request.url).searchParams.get("conversation"),
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
    })
    return Response.json(bootstrap, { headers: { "Cache-Control": "no-store" } })
    } catch (error) {
        const failure = deviceCommunicationErrorResponse(error)
        if (failure) return failure
        throw error
    }
}
