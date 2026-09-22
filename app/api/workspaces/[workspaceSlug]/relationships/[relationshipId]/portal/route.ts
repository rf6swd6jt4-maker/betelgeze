import { clientConversationCanAccess } from "@/lib/communications/access"
import { clientPortalOverview, portalProgressStatuses } from "@/lib/client-portal/overview"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const headers = { "Cache-Control": "private, no-store" }

async function context(params: Promise<{ workspaceSlug: string; relationshipId: string }>) {
    const { workspaceSlug, relationshipId } = await params
    const access = await requireWorkspacePanel(workspaceSlug, "communications")
    if (!UUID.test(relationshipId) || !await clientConversationCanAccess(access.workspace.id, relationshipId, access.user.id)) return null
    return { ...access, relationshipId }
}

async function overview(workspaceId: string, relationshipId: string) {
    const [{ data: actions, error: actionError }, { data: progress, error: progressError }] = await Promise.all([
        supabaseAdmin.from("client_portal_actions").select("id, title, status, completed_at, updated_at").eq("workspace_id", workspaceId).eq("relationship_id", relationshipId).order("status").order("sort_order").order("created_at").limit(50),
        supabaseAdmin.from("client_portal_service_progress").select("id, service_name, status, updated_at").eq("workspace_id", workspaceId).eq("relationship_id", relationshipId).order("created_at").limit(50),
    ])
    if (actionError || progressError) throw new Error("Client portal actions could not be loaded.")
    return clientPortalOverview({
        hasFulfilment: (actions?.length ?? 0) > 0 || (progress?.length ?? 0) > 0,
        leadMode: "empty",
        actions: (actions ?? []).map((item) => ({ id: item.id, title: item.title, status: item.status, completedAt: item.completed_at, updatedAt: item.updated_at })),
        progress: (progress ?? []).map((item) => ({ id: item.id, serviceName: item.service_name, status: item.status, updatedAt: item.updated_at })),
    })
}

export async function GET(_request: Request, route: { params: Promise<{ workspaceSlug: string; relationshipId: string }> }) {
    const resolved = await context(route.params)
    if (!resolved) return Response.json({ error: "Client chat not found." }, { status: 404, headers })
    try { return Response.json(await overview(resolved.workspace.id, resolved.relationshipId), { headers }) }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Client portal actions could not be loaded." }, { status: 503, headers }) }
}

export async function POST(request: Request, route: { params: Promise<{ workspaceSlug: string; relationshipId: string }> }) {
    const resolved = await context(route.params)
    if (!resolved) return Response.json({ error: "Client chat not found." }, { status: 404, headers })
    const input = await request.json().catch(() => null) as { title?: unknown } | null
    const title = typeof input?.title === "string" ? input.title.trim() : ""
    if (!title || title.length > 240) return Response.json({ error: "Enter an action of 240 characters or fewer." }, { status: 400, headers })
    const { error } = await supabaseAdmin.from("client_portal_actions").insert({ workspace_id: resolved.workspace.id, relationship_id: resolved.relationshipId, title, created_by: resolved.user.id })
    if (error) return Response.json({ error: "The action could not be added." }, { status: 503, headers })
    return Response.json(await overview(resolved.workspace.id, resolved.relationshipId), { headers })
}

export async function PATCH(request: Request, route: { params: Promise<{ workspaceSlug: string; relationshipId: string }> }) {
    const resolved = await context(route.params)
    if (!resolved) return Response.json({ error: "Client chat not found." }, { status: 404, headers })
    const input = await request.json().catch(() => null) as { kind?: unknown; id?: unknown; status?: unknown; updatedAt?: unknown } | null
    if (!UUID.test(typeof input?.id === "string" ? input.id : "") || typeof input?.updatedAt !== "string" || !Number.isFinite(Date.parse(input.updatedAt))) return Response.json({ error: "Reload the client actions and try again." }, { status: 400, headers })
    if (input.kind === "action" && (input.status === "open" || input.status === "completed")) {
        const completed = input.status === "completed"
        const { data, error } = await supabaseAdmin.from("client_portal_actions").update({ status: input.status, completed_at: completed ? new Date().toISOString() : null, completed_by: completed ? resolved.user.id : null, updated_at: new Date().toISOString() }).eq("workspace_id", resolved.workspace.id).eq("relationship_id", resolved.relationshipId).eq("id", input.id).eq("updated_at", input.updatedAt).select("id").maybeSingle()
        if (error) return Response.json({ error: "The action could not be updated." }, { status: 503, headers })
        if (!data) return Response.json({ error: "This action changed. Reload and try again." }, { status: 409, headers })
    } else if (input.kind === "progress" && typeof input.status === "string" && portalProgressStatuses.some((status) => status === input.status)) {
        const { data, error } = await supabaseAdmin.from("client_portal_service_progress").update({ status: input.status, updated_by: resolved.user.id, updated_at: new Date().toISOString() }).eq("workspace_id", resolved.workspace.id).eq("relationship_id", resolved.relationshipId).eq("id", input.id).eq("updated_at", input.updatedAt).select("id").maybeSingle()
        if (error) return Response.json({ error: "The progress could not be updated." }, { status: 503, headers })
        if (!data) return Response.json({ error: "This progress changed. Reload and try again." }, { status: 409, headers })
    } else return Response.json({ error: "Choose a valid update." }, { status: 400, headers })
    return Response.json(await overview(resolved.workspace.id, resolved.relationshipId), { headers })
}
