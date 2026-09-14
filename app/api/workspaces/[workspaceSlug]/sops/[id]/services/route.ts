import { requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { canAddSop } from "@/lib/sops/policy"
import { isSopId } from "@/lib/sops/records-policy"
import { sopMutationOrigin, sopPayload, sopPrivateHeaders as headers } from "@/lib/sops/http"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ workspaceSlug: string; id: string }> }
export async function GET(request: Request, context: Context) {
    const { workspaceSlug, id } = await context.params
    const { workspace, user, role } = await requireWorkspacePanel(workspaceSlug, "sops")
    if (!canAddSop(role) || !isSopId(id)) return Response.json({ error: "SOP administration required." }, { status: 403, headers })
    const query = new URL(request.url).searchParams, offset = Number(query.get("offset") ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return Response.json({ error: "Invalid page." }, { status: 400, headers })
    const kind = query.get("kind")
    if (kind === "catalogue") {
        const result = await supabaseAdmin.rpc("relationship_service_catalogue", { p_workspace_id: workspace.id, p_user_id: user.id, p_query: (query.get("q") ?? "").slice(0, 100), p_offset: offset })
        if (result.error) return Response.json({ error: "Could not load the service catalogue." }, { status: 503, headers })
        return Response.json({ items: result.data.slice(0, 30).map((item: { id: string; name: string }) => ({ id: item.id, name: item.name })), hasMore: result.data.length > 30 }, { headers })
    }
    if (kind === "sources") {
        const result = await supabaseAdmin.from("sop_assets").select("asset_id,asset:assets!inner(title,content_type,file_size)").eq("workspace_id", workspace.id).eq("sop_id", id).eq("role", "main").lte("asset.file_size", 20971520).not("asset.content_type", "like", "video/%").not("asset.content_type", "like", "audio/%").order("asset_id").range(offset, offset + 30)
        if (result.error) return Response.json({ error: "Could not load main SOP files." }, { status: 503, headers })
        return Response.json({ items: result.data.slice(0, 30).map(item => ({ id: item.asset_id, name: (item.asset as unknown as { title: string }).title })), hasMore: result.data.length > 30 }, { headers })
    }
    const result = await supabaseAdmin.rpc("read_sop_service_links", { p_workspace: workspace.id, p_actor: user.id, p_sop: id, p_offset: offset })
    if (result.error) return Response.json({ error: "Could not load linked services." }, { status: 503, headers })
    return Response.json({ items: result.data.slice(0, 30), hasMore: result.data.length > 30 }, { headers })
}
export async function POST(request: Request, context: Context) {
    const { workspaceSlug, id } = await context.params
    const { workspace, user, role } = await requireWorkspacePanel(workspaceSlug, "sops")
    if (!canAddSop(role) || !sopMutationOrigin(request)) return Response.json({ error: "Only admins can link SOP services." }, { status: 403, headers })
    try {
        const body = await sopPayload(request)
        if (body.userId !== user.id || ![id, body.serviceId, body.assetId].every(isSopId) || typeof body.unlink !== "boolean") return Response.json({ error: "Check the selected service and SOP file." }, { status: 400, headers })
        const result = await supabaseAdmin.rpc("link_sop_service", { p_workspace: workspace.id, p_actor: user.id, p_sop: id, p_service: body.serviceId, p_asset: body.assetId, p_unlink: body.unlink })
        if (result.error) return Response.json({ error: result.error.code === "P0001" ? result.error.message : "The link could not be saved. Retry the same selection." }, { status: 400, headers })
        return Response.json({ ok: true }, { headers })
    } catch { return Response.json({ error: "The link could not be saved. Retry the same selection." }, { status: 400, headers }) }
}
