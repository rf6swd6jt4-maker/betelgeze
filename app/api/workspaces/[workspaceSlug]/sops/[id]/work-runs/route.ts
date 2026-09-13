import { after } from "next/server"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { canAddSop } from "@/lib/sops/policy"
import { getSopAsset } from "@/lib/sops/records"
import { interpretationUnavailable, isSopId } from "@/lib/sops/records-policy"
import { processSopWork, sopWorkConfiguration } from "@/lib/sops/work-worker"
import { SOP_RUN_SUMMARY } from "@/lib/sops/work-server"
import { sopError, sopMutationOrigin, sopPayload, sopPrivateHeaders } from "@/lib/sops/http"
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
export async function POST(request: Request, context: Context) {
    const { workspaceSlug, id } = await context.params
    const { workspace, user, role } = await requireWorkspacePanel(workspaceSlug, "sops")
    if (!canAddSop(role) || !sopMutationOrigin(request)) return Response.json({ error: "Only admins can start pilot runs." }, { status: 403, headers: sopPrivateHeaders })
    try {
        const config = sopWorkConfiguration()
        if (!config.ready) return Response.json({ error: "SOP work generation is not enabled. Complete pilot setup first." }, { status: 503, headers: sopPrivateHeaders })
        const payload = await sopPayload(request)
        if (![id, payload?.id, payload?.assetId, payload?.relationshipId].every(isSopId) || typeof payload?.serviceKey !== "string" || payload.serviceKey.length > 100) throw new Error("Choose an SOP source and a test service.")
        const source = await getSopAsset(workspace.id, id, payload.assetId)
        if (!source) throw new Error("SOP asset not found.")
        const unavailable = interpretationUnavailable(source.asset)
        if (unavailable) throw new Error(unavailable)
        const queued = await supabaseAdmin.rpc("queue_sop_work", { p_workspace: workspace.id, p_actor: user.id, p_id: payload.id, p_sop: id, p_asset: payload.assetId, p_relationship: payload.relationshipId, p_service: payload.serviceKey, p_model: config.model, p_daily_limit: config.dailyLimit })
        if (queued.error || !queued.data) {
            const message = queued.error?.code === "P0001" ? queued.error.message : "Could not queue work generation. Check pilot setup and retry with the same request."
            throw new Error(message)
        }
        after(async () => { try { await processSopWork(queued.data as string) } catch { console.error("SOP work generation needs recovery") } })
        return Response.json({ id: queued.data }, { status: 202, headers: sopPrivateHeaders })
    } catch (error) { return sopError(error, "Could not request work generation.") }
}
