import { requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { canAddSop } from "@/lib/sops/policy"
import { isSopId } from "@/lib/sops/records-policy"
import { SOP_RUN_SUMMARY } from "@/lib/sops/work-server"
import { sopMutationOrigin, sopPrivateHeaders } from "@/lib/sops/http"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300
type Context = { params: Promise<{ workspaceSlug: string; id: string }> }
export async function GET(_request: Request, context: Context) {
    const { workspaceSlug, id } = await context.params
    const { workspace, role } = await requireWorkspacePanel(workspaceSlug, "sops")
    if (!canAddSop(role)) return Response.json({ error: "Only admins can view pilot runs." }, { status: 403, headers: sopPrivateHeaders })
    if (!isSopId(id)) return Response.json({ error: "Not found." }, { status: 404, headers: sopPrivateHeaders })
    const result = await supabaseAdmin.from("sop_work_runs").select(SOP_RUN_SUMMARY).eq("workspace_id", workspace.id).eq("sop_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(10)
    return Response.json(result.error ? { error: "Could not load recent pilot runs." } : { items: result.data }, { status: result.error ? 503 : 200, headers: sopPrivateHeaders })
}
// The old manual pilot form is retired. Service assignment is the only UI entry.
export async function POST(request: Request, context: Context) {
    const { workspaceSlug } = await context.params
    const { role } = await requireWorkspacePanel(workspaceSlug, "sops")
    if (!canAddSop(role) || !sopMutationOrigin(request)) return Response.json({ error: "SOP administration required." }, { status: 403, headers: sopPrivateHeaders })
    return Response.json({ error: "Link a service on the SOP, then add the service from its relationship." }, { status: 410, headers: sopPrivateHeaders })
}
