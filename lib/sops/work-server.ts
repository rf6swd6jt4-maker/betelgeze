import "server-only"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { sopCursor } from "./policy"
import { sopCostReport, type SopUsageEntry } from "./pricing"

export async function sopTestRelationships(workspaceId: string, cursorValue?: string) {
    const cursor = sopCursor(cursorValue)
    let query = supabaseAdmin.from("relationships").select("id,primary_person_name,business_name,created_at,lifecycle_phase").eq("workspace_id", workspaceId).eq("source_metadata->>is_test", "true")
    if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
    const result = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(25)
    if (result.error) throw new Error("Could not load test relationships.")
    const items = (result.data ?? []).slice(0, 24), last = items.at(-1)
    return { items, next: result.data && result.data.length > 24 && last ? `${last.created_at}|${last.id}` : null }
}
export async function sopTestServices(workspaceId: string, relationshipId: string) {
    const relationship = await supabaseAdmin.from("relationships").select("id").eq("workspace_id", workspaceId).eq("id", relationshipId).eq("source_metadata->>is_test", "true").maybeSingle()
    if (relationship.error || !relationship.data) throw new Error("Test relationship not found.")
    const services = await supabaseAdmin.from("relationship_service_instances").select("id,service_key,revision:onboarding_service_revisions(name)").eq("workspace_id", workspaceId).eq("relationship_id", relationshipId).eq("stage", "setup").eq("disposition", "active").is("import_id", null).order("created_at").limit(30)
    if (services.error) throw new Error("Could not load test services.")
    if (!services.data?.length) throw new Error("Add a service using Already onboarded → Setup first.")
    const rows = services.data as unknown as { id: string; service_key: string; revision: { name: string } | null }[]
    return rows.map(row => ({ key: row.id, name: row.revision?.name ?? row.service_key }))
}
export const SOP_RUN_SUMMARY = "id,relationship_id,service_key,asset_id,interpretation_id,status,attempts,model,work_item_ids,error_summary,created_at,updated_at,warnings:plan->warnings"
export async function sopWorkReport(workspaceId: string, sopId: string, runId: string) {
    const run = await supabaseAdmin.from("sop_work_runs").select(SOP_RUN_SUMMARY).eq("workspace_id", workspaceId).eq("sop_id", sopId).eq("id", runId).maybeSingle()
    if (run.error) throw new Error("Could not load this generation run.")
    if (!run.data) return null
    const fields = "id,stage,run_id,model,status,usage,estimated_usd,rate,created_at"
    const [generation, sources] = await Promise.all([
        supabaseAdmin.from("sop_ai_usage").select(fields).eq("workspace_id", workspaceId).eq("run_id", runId).eq("stage", "generation").order("created_at").limit(4),
        supabaseAdmin.from("sop_ai_usage").select(fields).eq("workspace_id", workspaceId).eq("interpretation_id", run.data.interpretation_id).eq("stage", "interpretation").order("created_at").limit(4),
    ])
    if (generation.error || sources.error) throw new Error("Could not load usage. Costs are unavailable until this read succeeds.")
    const entries = [...(sources.data ?? []), ...(generation.data ?? [])] as unknown as SopUsageEntry[]
    const ids = run.data.work_item_ids as string[]
    const work = ids.length ? await supabaseAdmin.from("work_items").select("id,title").eq("workspace_id", workspaceId).in("id", ids.slice(0, 40)) : { data: [], error: null }
    if (work.error) throw new Error("Work was published, but its titles could not be loaded. Retry this read.")
    const sourceHistoryUnmetered = !sources.data?.length
    return { ...run.data, workItems: ids.map(id => work.data?.find(item => item.id === id)).filter(Boolean), entries, costs: sopCostReport(entries, runId), sourceHistoryUnmetered }
}
