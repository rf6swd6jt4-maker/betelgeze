import { supabaseAdmin } from "@/lib/supabase/admin"
import { isSopId } from "@/lib/sops/records-policy"
import { requireWorkspace } from "@/lib/workspaces"
import { canAddSop } from "@/lib/sops/policy"
import { getSopRecord, updateSopRecord } from "@/lib/sops/records"
import { sopError, sopMutationOrigin, sopPayload, sopPrivateHeaders } from "@/lib/sops/http"
export const dynamic = "force-dynamic"
export async function PATCH(request: Request, context: { params: Promise<{ workspaceSlug: string; id: string }> }) {
    const { workspaceSlug, id } = await context.params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    if (!canAddSop(role) || !sopMutationOrigin(request)) return Response.json({ error: "Only admins can change SOPs." }, { status: 403, headers: sopPrivateHeaders })
    try {
        const body = await sopPayload(request)
        if (body.field !== undefined) {
            if (!isSopId(id) || body.userId !== user.id || !["title", "description"].includes(body.field) || typeof body.value !== "string" || typeof body.baseline !== "string") return Response.json({ error: "Invalid SOP edit." }, { status: 400, headers: sopPrivateHeaders })
            const result = await supabaseAdmin.rpc("save_sop_text", { p_workspace: workspace.id, p_actor: user.id, p_sop: id, p_field: body.field, p_value: body.value, p_baseline: body.baseline })
            if (result.error) return Response.json({ error: result.error.code === "P0001" ? result.error.message : "Could not save the SOP." }, { status: 400, headers: sopPrivateHeaders })
            if (!result.data) return Response.json({ error: "This field changed elsewhere or the SOP was archived. Your draft is preserved." }, { status: 409, headers: sopPrivateHeaders })
            return Response.json(result.data, { headers: sopPrivateHeaders })
        }
        return Response.json({ version: await updateSopRecord(workspace.id, user.id, id, body) }, { headers: sopPrivateHeaders })
    }
    catch (error) { return sopError(error, "Could not save the SOP.") }
}

export async function GET(_request: Request, context: { params: Promise<{ workspaceSlug: string; id: string }> }) {
    const { workspaceSlug, id } = await context.params
    const { workspace } = await requireWorkspace(workspaceSlug)
    const sop = await getSopRecord(workspace.id, id)
    return Response.json(sop ?? { error: "SOP not found." }, { status: sop ? 200 : 404, headers: sopPrivateHeaders })
}
