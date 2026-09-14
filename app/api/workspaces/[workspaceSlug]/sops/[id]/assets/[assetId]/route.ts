import { supabaseAdmin } from "@/lib/supabase/admin"
import { canAddSop } from "@/lib/sops/policy"
import { isSopId } from "@/lib/sops/records-policy"
import { sopMutationOrigin, sopPayload, sopPrivateHeaders } from "@/lib/sops/http"
import { requireWorkspace } from "@/lib/workspaces"
import { sopAssetResponse } from "@/lib/sops/assets"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string; id: string; assetId: string }> }) {
    const { workspaceSlug, id, assetId } = await context.params
    const { workspace } = await requireWorkspace(workspaceSlug)
    return sopAssetResponse(workspace.id, id, assetId, request)
}

export async function PATCH(request: Request, context: { params: Promise<{ workspaceSlug: string; id: string; assetId: string }> }) {
    const { workspaceSlug, id, assetId } = await context.params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    if (!canAddSop(role) || !sopMutationOrigin(request)) return Response.json({ error: "Only admins can change the main procedure." }, { status: 403, headers: sopPrivateHeaders })
    try {
        const body = await sopPayload(request)
        if (body.action !== "main" || ![id, assetId].every(isSopId)) throw new Error("Invalid procedure selection.")
        const result = await supabaseAdmin.rpc("set_sop_main_asset", { p_workspace: workspace.id, p_actor: user.id, p_sop: id, p_asset: assetId })
        if (result.error) throw new Error(result.error.code === "P0001" ? result.error.message : "Could not save the main procedure.")
        return Response.json({ ok: true }, { headers: sopPrivateHeaders })
    } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Could not save the main procedure." }, { status: 400, headers: sopPrivateHeaders }) }
}
