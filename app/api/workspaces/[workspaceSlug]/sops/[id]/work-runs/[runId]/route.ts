import { after } from "next/server"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { canAddSop } from "@/lib/sops/policy"
import { isSopId } from "@/lib/sops/records-policy"
import { sopWorkReport } from "@/lib/sops/work-server"
import { processSopWork, sopWorkConfiguration } from "@/lib/sops/work-worker"
import { sopError, sopMutationOrigin, sopPayload, sopPrivateHeaders } from "@/lib/sops/http"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300
type Context = { params: Promise<{ workspaceSlug: string; id: string; runId: string }> }
export async function GET(request: Request, context: Context) {
    const { workspaceSlug, id, runId } = await context.params
    const { workspace, role } = await requireWorkspacePanel(workspaceSlug, "sops")
    if (!canAddSop(role)) return Response.json({ error: "Only admins can view pilot costs." }, { status: 403, headers: sopPrivateHeaders })
    if (![id, runId].every(isSopId)) return Response.json({ error: "Not found." }, { status: 404, headers: sopPrivateHeaders })
    try {
        const report = await sopWorkReport(workspace.id, id, runId)
        const headers = report && new URL(request.url).searchParams.get("download") === "1" ? { ...sopPrivateHeaders, "Content-Disposition": `attachment; filename="sop-work-${runId}.json"` } : sopPrivateHeaders
        return Response.json(report ?? { error: "Not found." }, { status: report ? 200 : 404, headers })
    } catch (error) { return sopError(error, "Could not load the cost report.") }
}
export async function POST(request: Request, context: Context) {
    const { workspaceSlug, id, runId } = await context.params
    const { workspace, user, role } = await requireWorkspacePanel(workspaceSlug, "sops")
    if (!canAddSop(role) || !sopMutationOrigin(request)) return Response.json({ error: "Only admins can resume a pilot run." }, { status: 403, headers: sopPrivateHeaders })
    if (![id, runId].every(isSopId)) return Response.json({ error: "Not found." }, { status: 404, headers: sopPrivateHeaders })
    try {
        const config = sopWorkConfiguration()
        if (!config.ready) throw new Error("SOP work generation is not enabled.")
        const run = await supabaseAdmin.from("sop_work_runs").select("id,status").eq("workspace_id", workspace.id).eq("sop_id", id).eq("id", runId).maybeSingle()
        if (run.error || !run.data) return Response.json({ error: "Not found." }, { status: 404, headers: sopPrivateHeaders })
        const payload = await sopPayload(request)
        if (run.data.status === "failed") {
            if (payload?.retry !== true) throw new Error("An explicit retry is required. The previous attempt may have incurred a charge.")
            const retry = await supabaseAdmin.rpc("retry_sop_work", { p_workspace: workspace.id, p_actor: user.id, p_id: runId, p_daily_limit: config.dailyLimit })
            if (retry.error) throw new Error(retry.error.code === "P0001" ? retry.error.message : "Could not retry generation.")
        }
        after(async () => { try { await processSopWork(runId) } catch { console.error("SOP work generation needs recovery") } })
        return Response.json({ id: runId }, { status: 202, headers: sopPrivateHeaders })
    } catch (error) { return sopError(error, "Could not resume generation.") }
}
