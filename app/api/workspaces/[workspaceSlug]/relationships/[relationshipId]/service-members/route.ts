import { unstable_rethrow } from "next/navigation"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { isQueueUuid, isServiceRosterRequest } from "@/lib/shared-service-queue"
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" }
type Context = { params: Promise<{ workspaceSlug: string; relationshipId: string }> }
async function handle(request: Request, context: Context, write: boolean) {
    if (write && request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin" }, { status: 403, headers })
    try {
        const { workspaceSlug, relationshipId } = await context.params
        const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
        if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your account changed. Reopen this service.", code: "account_changed" }, { status: 409, headers })
        if (!isQueueUuid(relationshipId)) return Response.json({ error: "Invalid client" }, { status: 400, headers })
        const body: unknown = write ? await request.json() : null
        const instanceId = write && isServiceRosterRequest(body) ? body.instanceId : new URL(request.url).searchParams.get("instance")
        if (!isQueueUuid(instanceId) || write && !isServiceRosterRequest(body)) return Response.json({ error: "Check the selected assignees" }, { status: 400, headers })
        const args = { p_workspace: workspace.id, p_relationship: relationshipId, p_instance: instanceId, p_actor: user.id }
        const result = write && isServiceRosterRequest(body)
            ? await supabaseAdmin.rpc("save_service_queue_roster", { ...args, p_request: body.requestId, p_version: body.version, p_members: body.members })
            : await supabaseAdmin.rpc("read_service_queue_roster", args)
        if (result.error) return Response.json({ error: result.error.code === "P0001" ? result.error.message : "This request was not confirmed. Retry the same request." }, { status: result.error.code === "P0001" ? 409 : 503, headers })
        return Response.json(result.data, { headers })
    } catch (error) {
        unstable_rethrow(error)
        return Response.json({ error: "This request was not confirmed. Reopen this service to retry." }, { status: 503, headers })
    }
}
export const GET = (request: Request, context: Context) => handle(request, context, false)
export const POST = (request: Request, context: Context) => handle(request, context, true)
