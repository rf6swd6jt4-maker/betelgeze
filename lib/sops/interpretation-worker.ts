import "server-only"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getSopAsset } from "./records"
import { interpretSopAsset, sopAiConfiguration } from "./interpreter"
type Job = { id: string; workspace_id: string; sop_id: string; asset_id: string; requested_by: string; model: string; lease_token: string }
export async function processSopInterpretation(id?: string) {
    if (!sopAiConfiguration().ready) return { claimed: 0, completed: 0 }
    const claim = await supabaseAdmin.rpc("claim_sop_interpretation", { p_id: id ?? null })
    if (claim.error) throw new Error("Could not claim an interpretation.")
    const job = (claim.data as Job[] | null)?.[0]
    if (!job) return { claimed: 0, completed: 0 }
    let outcome: Awaited<ReturnType<typeof interpretSopAsset>> | null = null, error: string | null = null
    try {
        // Recheck current authority immediately before sending any source to OpenAI.
        const [access, sop, linked] = await Promise.all([
            supabaseAdmin.rpc("assert_sop_admin", { p_workspace: job.workspace_id, p_actor: job.requested_by }),
            supabaseAdmin.from("sops").select("id,archived_at").eq("workspace_id", job.workspace_id).eq("id", job.sop_id).maybeSingle(),
            getSopAsset(job.workspace_id, job.sop_id, job.asset_id),
        ])
        if (access.error || sop.error || !sop.data || sop.data.archived_at || !linked) throw new Error("This source is no longer available for interpretation.")
        outcome = await interpretSopAsset({ workspaceId: job.workspace_id, sopId: job.sop_id, linked, model: job.model })
    } catch (e) {
        // Never persist raw provider bodies, credentials, document text or SDK errors.
        error = e instanceof Error && /^(OpenAI |The source |This source |Split text |Interpretation |The interpretation |An interpretation |Stored for viewing)/.test(e.message) ? e.message.slice(0, 500) : "Interpretation failed. Review the file and API setup before retrying."
    }
    const finish = await supabaseAdmin.rpc("finish_sop_interpretation", { p_id: job.id, p_lease: job.lease_token, p_result: outcome?.result ?? null, p_hash: outcome?.sourceHash ?? null, p_input: outcome?.inputTokens ?? null, p_output: outcome?.outputTokens ?? null, p_error: error })
    if (finish.error || finish.data !== true) throw new Error("Interpretation completion was not confirmed; the job requires recovery.")
    return { claimed: 1, completed: outcome ? 1 : 0 }
}
