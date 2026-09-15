import "server-only"
import { workFailureMessage, workDatabaseError } from "./work-errors"
import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { parseSopInterpretation, type SopInterpretation } from "./interpretation"
import { sopAiConfiguration } from "./interpreter"
import { processSopInterpretation } from "./interpretation-worker"
import { generateSopWork } from "./work-generator"
import { sopLedgerRequest } from "./usage-ledger"
import { parseSopWorkPlan, SOP_WORK_VERSION, type SopWorkPlan } from "./work-plan"
import { validateAssetSelections,type AssetCandidate } from './asset-selection'

export function sopWorkConfiguration() {
    const config = sopAiConfiguration()
    return { ...config, ready: config.ready && process.env.SOP_WORK_PILOT_ENABLED === "true" }
}
type Job = { id: string; workspace_id: string; relationship_id: string; sop_id: string; interpretation_id: string; requested_by: string; model: string; lease_token: string; plan: SopWorkPlan | null; source_snapshot: SopInterpretation | null;schema_version?:string;asset_candidates:AssetCandidate[]|null }
export async function processSopWork(id?: string, instanceId?: string) {
    if (!sopWorkConfiguration().ready) return { claimed: 0, published: 0 }
    if (!id) {
        const config = sopWorkConfiguration()
        const accepted = await supabaseAdmin.rpc("accept_sop_work_request", { p_instance: instanceId ?? null, p_model: config.model, p_daily_limit: config.dailyLimit })
        if (accepted.error) throw new Error("Could not accept pending SOP work.")
        if (accepted.data) id = accepted.data as string
        else if (instanceId) return { claimed: 0, published: 0 }
    }
    const claim = await supabaseAdmin.rpc("claim_sop_work", { p_id: id ?? null })
    if (claim.error) throw new Error("Could not claim work generation.")
    const job = (claim.data as Job[] | null)?.[0]
    if (!job) return { claimed: 0, published: 0 }
    const save = async (values: object) => {
        const saved = await supabaseAdmin.from("sop_work_runs").update({ ...values, updated_at: new Date().toISOString() }).eq("id", job.id).eq("workspace_id", job.workspace_id).eq("status", "running").eq("lease_token", job.lease_token).gt("lease_until", new Date().toISOString()).select("id").maybeSingle()
        if (saved.error || !saved.data) throw new Error("Work-generation state was not confirmed. Check the run before retrying.")
    }
    try {
        const prepare = await supabaseAdmin.rpc("prepare_sop_work", { p_id: job.id, p_lease: job.lease_token })
        if (prepare.error || !prepare.data) throw new Error(workDatabaseError("preparation failed", prepare.error ?? {}))
        if (!job.plan) {
            const sourceRead = async () => {
                const source = await supabaseAdmin.from("sop_interpretations").select("id,status,result,error_summary").eq("workspace_id", job.workspace_id).eq("sop_id", job.sop_id).eq("id", job.interpretation_id).maybeSingle()
                if (source.error || !source.data) throw new Error("SOP interpretation could not be loaded.")
                return source.data
            }
            let source = await sourceRead()
            if (source.status === "queued") {
                await processSopInterpretation(job.interpretation_id, { runId: job.id })
                source = await sourceRead()
            }
            if (["running", "queued"].includes(source.status)) {
                await save({ status: "queued", lease_token: null, lease_until: null })
                return { claimed: 1, published: 0 }
            }
            if (!["ready", "reviewed"].includes(source.status)) throw new Error("SOP interpretation failed. Check the linked main procedure file.")
            const interpretation = parseSopInterpretation(source.result)
            if (!interpretation.steps.length) throw new Error("The SOP interpretation has no actionable steps. Choose a procedure with readable instructions.")
            // Extraction can take time. Recheck revocation and evidence before the second paid call.
            const current = await supabaseAdmin.rpc("prepare_sop_work", { p_id: job.id, p_lease: job.lease_token })
            if (current.error || !current.data || !sopWorkConfiguration().ready) throw new Error("Client information or access changed before generation. No work was published.")
            const candidateRead=await supabaseAdmin.rpc('sop_work_asset_candidates',{p_id:job.id,p_lease:job.lease_token,p_image_ids:[...new Set(interpretation.steps.flatMap(step=>step.image_ids??[]))]})
            if(candidateRead.error)throw new Error('Could not read permitted asset candidates.')
            const assets=(candidateRead.data as AssetCandidate[]).map(a=>({...a,description:Array.from(a.description).slice(0,1000).join(''),source_steps:interpretation.steps.flatMap((s,i)=>s.image_ids?.includes(a.id)?[i+1]:[])})).filter(a=>a.kind!=='extracted_image'||a.source_steps.length)
            await save({asset_candidates:assets})
            const plan = await generateSopWork({ model: job.model, source: interpretation,assets }, sopLedgerRequest({ id: job.lease_token, workspaceId: job.workspace_id, model: job.model, stage: "generation", runId: job.id }), async output => {
                await save({ raw_output: output, source_snapshot: interpretation, schema_version: SOP_WORK_VERSION })
            })
            // Save before publication. A lost acknowledgement can retry publication without paying again.
            await save({ plan, source_snapshot: interpretation })
        } else {
            parseSopWorkPlan(job.plan, parseSopInterpretation(job.source_snapshot), ["sop-work-assets-v7", SOP_WORK_VERSION].includes(job.schema_version ?? ""))
            validateAssetSelections(job.plan,parseSopInterpretation(job.source_snapshot),job.asset_candidates??[])
        }
        const publish = await supabaseAdmin.rpc("publish_sop_work", { p_id: job.id, p_lease: job.lease_token })
        if (publish.error) throw new Error(workDatabaseError("publication failed", publish.error))
        if (!Array.isArray(publish.data) || !publish.data.length) throw new Error("Work publication returned no items; check the saved run before retrying.")
    } catch (error) {
        const message = workFailureMessage(error)
        // A lost publication acknowledgement must not overwrite committed success.
        const failed = await supabaseAdmin.from("sop_work_runs").update({ status: "failed", error_summary: message, lease_token: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id).eq("workspace_id", job.workspace_id).eq("status", "running").eq("lease_token", job.lease_token).select("id").maybeSingle()
        if (failed.error || !failed.data) {
            const actual = await supabaseAdmin.from("sop_work_runs").select("status").eq("id", job.id).eq("workspace_id", job.workspace_id).maybeSingle()
            if (actual.error || !actual.data) throw new Error("Work status could not be confirmed; check progress again.")
            if (actual.data.status !== "published") return { claimed: 1, published: 0 }
        } else return { claimed: 1, published: 0 }
    }
    // Cache invalidation is best effort after the transaction; never undo a published run.
    const workspace = await supabaseAdmin.from("workspaces").select("slug").eq("id", job.workspace_id).maybeSingle()
    if (workspace.data?.slug) {
        try {
            for (const route of ["work-items", `work/${job.relationship_id}`, `relationships/${job.relationship_id}`]) revalidatePath(`/${workspace.data.slug}/${route}`)
        } catch { /* The Library's authorized read path remains authoritative. */ }
    }
    return { claimed: 1, published: 1 }
}
