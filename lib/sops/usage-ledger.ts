import "server-only"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { meteredSopRequest } from "./metered-request"

export function sopLedgerRequest(input: { id: string; workspaceId: string; model: string; stage: "interpretation" | "generation"; interpretationId?: string; runId?: string }) {
    return meteredSopRequest(input.model, {
        async start(value) {
            const { error } = await supabaseAdmin.from("sop_ai_usage").insert({ id: input.id, workspace_id: input.workspaceId, interpretation_id: input.interpretationId ?? null, run_id: input.runId ?? null, stage: input.stage, ...value })
            if (error) throw new Error("Could not reserve the usage record. No OpenAI request was sent.")
        },
        async finish(value) {
            const { data, error } = await supabaseAdmin.from("sop_ai_usage").update(value).eq("workspace_id", input.workspaceId).eq("id", input.id).select("id").maybeSingle()
            if (error || !data) throw new Error("Could not save OpenAI usage. The request may have incurred a charge.")
        },
    })
}
