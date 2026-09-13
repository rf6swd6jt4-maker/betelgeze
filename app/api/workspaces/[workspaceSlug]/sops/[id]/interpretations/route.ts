import { after } from "next/server"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { canAddSop } from "@/lib/sops/policy"
import { getSopAsset } from "@/lib/sops/records"
import { interpretationUnavailable, isSopId } from "@/lib/sops/records-policy"
import { SOP_INTERPRETATION_VERSION } from "@/lib/sops/interpretation"
import { sopAiConfiguration } from "@/lib/sops/interpreter"
import { processSopInterpretation } from "@/lib/sops/interpretation-worker"
import { sopError, sopMutationOrigin, sopPayload, sopPrivateHeaders } from "@/lib/sops/http"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300
export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string; id: string }> }) {
    const { workspaceSlug, id } = await context.params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    if (!canAddSop(role) || !sopMutationOrigin(request)) return Response.json({ error: "Only admins can interpret assets." }, { status: 403, headers: sopPrivateHeaders })
    try {
        const config = sopAiConfiguration()
        if (!config.ready) return Response.json({ error: "Interpretation is not enabled. Complete OpenAI setup first." }, { status: 503, headers: sopPrivateHeaders })
        const payload = await sopPayload(request)
        if (!isSopId(payload?.assetId)) throw new Error("Choose a valid SOP asset.")
        const linked = await getSopAsset(workspace.id, id, payload.assetId)
        if (!linked) throw new Error("Asset not found.")
        const unavailable = interpretationUnavailable(linked.asset)
        if (unavailable) throw new Error(unavailable)
        const queued = await supabaseAdmin.rpc("queue_sop_interpretation", { p_workspace: workspace.id, p_actor: user.id, p_sop: id, p_asset: linked.asset_id, p_schema: SOP_INTERPRETATION_VERSION, p_model: config.model, p_retry: payload.retry === true, p_daily_limit: config.dailyLimit })
        if (queued.error || !queued.data) throw new Error("Could not queue interpretation. Check the daily limit, previous attempts and whether this SOP is archived.")
        const jobId = String(queued.data)
        after(async () => { try { await processSopInterpretation(jobId) } catch { console.error("SOP interpretation needs recovery") } })
        return Response.json({ id: jobId, status: "accepted" }, { status: 202, headers: sopPrivateHeaders })
    } catch (error) { return sopError(error, "Could not request interpretation.") }
}
