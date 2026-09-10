import { unstable_rethrow } from "next/navigation"
import { isRedirectError } from "next/dist/client/components/redirect-error"
import { getURLFromRedirectError } from "next/dist/client/components/redirect"
import { loadAuthorizedGanttPlan, RelationshipGanttNotFoundError, requireGantt } from "@/lib/relationship-gantt-server"

export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request, { params }: { params: Promise<{ workspaceSlug: string; relationshipId: string }> }) {
    const { workspaceSlug, relationshipId } = await params
    if (!uuid.test(relationshipId)) return Response.json({ error: "Relationship not found." }, { status: 404, headers })
    try {
        const context = await requireGantt(workspaceSlug, relationshipId)
        if (request.headers.get("x-workspace-user") !== context.user.id) return Response.json({ error: "Your session changed. Reload the workspace." }, { status: 409, headers })
        const plan = await loadAuthorizedGanttPlan(context, relationshipId)
        if (!plan) return Response.json({ error: "Relationship not found." }, { status: 404, headers })
        return Response.json({ userId: context.user.id, relationshipId, plan }, { headers })
    } catch (error) {
        // Preserve requireWorkspace's exact AAL2/membership checks, but return
        // JSON to this read client instead of redirecting it to an HTML page.
        if (isRedirectError(error)) {
            const path = new URL(getURLFromRedirectError(error), request.url).pathname
            if (path === "/login" || path === "/mfa") return Response.json({ error: "Sign in and verify your session to refresh this plan." }, { status: 401, headers })
            if (path === "/workspaces") return Response.json({ error: "You no longer have access to this plan." }, { status: 403, headers })
        }
        unstable_rethrow(error)
        if (error instanceof RelationshipGanttNotFoundError) return Response.json({ error: "Relationship not found." }, { status: 404, headers })
        return Response.json({ error: "Could not refresh the plan. Please retry." }, { status: 503, headers })
    }
}
