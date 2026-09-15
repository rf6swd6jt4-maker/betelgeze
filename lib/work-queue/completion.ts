import "server-only"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { completeWorkflowParents } from "@/lib/relationship-workflow"
/** Durable follow-up reuses the canonical completion rules; a lost response cannot strand a parent. */
export async function processQueueCompletion() {
    const claimed = await supabaseAdmin.rpc("claim_queue_completion")
    if (claimed.error) throw new Error("Could not claim completion follow-up")
    const job = claimed.data?.[0] as { work_item_id: string; workspace_id: string; lease_token: string } | undefined
    if (!job) return
    try {
        const item = await supabaseAdmin.from("work_items").select("status").eq("workspace_id",job.workspace_id).eq("id",job.work_item_id).maybeSingle()
        if (item.error) throw new Error("Could not read completed work")
        if (item.data?.status === "done") {
            const links = await supabaseAdmin.from("work_item_relationships").select("relationship_id").eq("workspace_id",job.workspace_id).eq("work_item_id",job.work_item_id)
            if (links.error) throw new Error("Could not read work relationships")
            for (const link of links.data ?? []) await completeWorkflowParents({ workspaceId:job.workspace_id,relationshipId:link.relationship_id,workItemId:job.work_item_id })
        }
        const saved = await supabaseAdmin.from("work_queue_completion_followups").update({ completed_at:new Date().toISOString(),lease_until:null,lease_token:null,error_summary:null }).eq("work_item_id",job.work_item_id).eq("lease_token",job.lease_token)
        if (saved.error) throw new Error("Completion follow-up was not confirmed")
    } catch {
        await supabaseAdmin.from("work_queue_completion_followups").update({error_summary:"Parent workflow update needs retry; completion remains saved."}).eq("work_item_id",job.work_item_id).eq("lease_token",job.lease_token)
    }
}
