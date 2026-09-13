import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { canAddSop } from "@/lib/sops/policy"
import { isSopId } from "@/lib/sops/records-policy"
import { sopMutationOrigin, sopPrivateHeaders } from "@/lib/sops/http"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ workspaceSlug: string; id: string; jobId: string }> }
export async function GET(_request: Request, context: Context) {
    const { workspaceSlug, id, jobId } = await context.params
    const { workspace } = await requireWorkspace(workspaceSlug)
    if (![id, jobId].every(isSopId)) return Response.json({ error: "Not found." }, { status: 404, headers: sopPrivateHeaders })
    const { data, error } = await supabaseAdmin.from("sop_interpretations").select("id,asset_id,status,result,error_summary,model,source_hash,input_tokens,output_tokens,updated_at,reviewed_at").eq("workspace_id", workspace.id).eq("sop_id", id).eq("id", jobId).maybeSingle()
    if (error) return Response.json({ error: "Could not load interpretation." }, { status: 503, headers: sopPrivateHeaders })
    return Response.json(data ?? { error: "Not found." }, { status: data ? 200 : 404, headers: sopPrivateHeaders })
}
export async function POST(request: Request, context: Context) {
    const { workspaceSlug, id, jobId } = await context.params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    if (!canAddSop(role) || !sopMutationOrigin(request)) return Response.json({ error: "Only admins can review interpretations." }, { status: 403, headers: sopPrivateHeaders })
    if (![id, jobId].every(isSopId)) return Response.json({ error: "Not found." }, { status: 404, headers: sopPrivateHeaders })
    const result = await supabaseAdmin.rpc("review_sop_interpretation", { p_workspace: workspace.id, p_actor: user.id, p_sop: id, p_id: jobId })
    if (result.error || result.data !== true) return Response.json({ error: "This interpretation is not ready for review or has already changed. Refresh to check." }, { status: 409, headers: sopPrivateHeaders })
    return Response.json({ reviewed: true }, { headers: sopPrivateHeaders })
}
