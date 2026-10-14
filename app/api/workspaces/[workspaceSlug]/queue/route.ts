import { after } from "next/server"
import { processQueueCompletion } from "@/lib/work-queue/completion"
import { unstable_rethrow } from "next/navigation"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { isQueueCommandRequest, isQueueUuid } from "@/lib/shared-service-queue"
const headers = { "Cache-Control": "private, no-store" }
export async function POST(request: Request, { params }: { params: Promise<{ workspaceSlug: string }> }) {
    if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin" }, { status: 403, headers })
    try {
        const { workspaceSlug } = await params
        const { workspace, user } = await requireWorkspace(workspaceSlug)
        if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your session changed", code: "account_changed" }, { status: 409, headers })
        const body = await request.json()
        if (!body || !isQueueUuid(body.id) || !["start","pause","complete"].includes(body.action) || typeof body.version !== "string" || !Number.isFinite(Date.parse(body.version)) || ("requestId" in body && !isQueueCommandRequest(body))) return Response.json({ error: "Invalid work action" }, { status: 400, headers })
        const result = isQueueCommandRequest(body)
            ? await supabaseAdmin.rpc("shared_queue_command", { p_workspace: workspace.id, p_user: user.id, p_item: body.id, p_action: body.action, p_version: body.version, p_request: body.requestId })
            : await supabaseAdmin.rpc("personal_queue_command", { p_workspace: workspace.id, p_user: user.id, p_item: body.id, p_action: body.action, p_version: body.version })
        if (result.error) return Response.json({ error: result.error.code === "P0001" ? result.error.message : "This change was not confirmed. Refresh before retrying." }, { status: result.error.code === "P0001" ? 409 : 503, headers })
        if (body.action === "complete") after(async () => { try { await processQueueCompletion() } catch { console.error("Queue completion follow-up remains pending") } })
        return Response.json(result.data, { headers })
    } catch(error) {
        unstable_rethrow(error)
        return Response.json({ error: "This change was not confirmed. Refresh before retrying." }, { status: 500, headers })
    }
}
