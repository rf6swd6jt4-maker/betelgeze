"use server"
import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { isServiceStage } from "@/lib/service-stages"
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export async function addRelationshipService(slug: string, relationshipId: string, input: { requestId: string; expectedUserId: string; serviceId: string; revisionId: string; origin: string; stage: string; assigneeId: string; sellerId: string; managerId: string }) {
    const { workspace, user, access } = await requireWorkspacePanel(slug, "relationships")
    await requireRelationshipAccess(access, relationshipId)
    const completedImport = input.origin === "already_onboarded" && input.stage === "completed"
    if (user.id !== input.expectedUserId || !uuid.test(input.requestId) || !uuid.test(input.serviceId) || !uuid.test(input.revisionId) || (input.assigneeId && !uuid.test(input.assigneeId))
        || (completedImport ? !uuid.test(input.sellerId) || !uuid.test(input.managerId) : Boolean(input.sellerId || input.managerId))
        || !((input.origin === "negotiation" && input.stage === "negotiating") || (input.origin === "already_onboarded" && ["setup", "maintenance", "completed"].includes(input.stage)))) return { ok: false, error: "Check the service and starting stage." }
    let result
    if (completedImport) result = await supabaseAdmin.rpc("add_completed_relationship_service", { p_workspace_id: workspace.id, p_relationship_id: relationshipId, p_actor_user_id: user.id, p_request_id: input.requestId, p_service_id: input.serviceId, p_revision_id: input.revisionId, p_assignee_user_id: input.assigneeId || null, p_seller_user_id: input.sellerId, p_manager_user_id: input.managerId })
    else {
        const { sopWorkConfiguration } = await import("@/lib/sops/work-worker")
        result = await supabaseAdmin.rpc("add_relationship_service_with_sop", { p_workspace_id: workspace.id, p_relationship_id: relationshipId, p_actor_user_id: user.id, p_request_id: input.requestId, p_service_id: input.serviceId, p_revision_id: input.revisionId, p_origin: input.origin, p_stage: input.stage, p_assignee_user_id: input.assigneeId || null, p_generation_enabled: sopWorkConfiguration().ready })
    }
    const { data, error } = result
    if (error) return { ok: false, uncertain: !/^[0-9A-Z]{5}$/.test(error.code ?? ""), error: error.code === "P0001" ? error.message : "The save could not be confirmed. Retry to recover this same service." }
    if (!completedImport) after(async () => { const { processSopWork } = await import("@/lib/sops/work-worker"); await processSopWork(undefined, data.id as string) })
    // Keep the initiating dialog mounted while the durable job runs.
    // The worker invalidates published work; the dialog fetches the queue before closing.
    if (!data.generation) {
        revalidatePath(`/${slug}/relationships`)
        revalidatePath(`/${slug}/relationships/${relationshipId}`)
    }
    return { ok: true, id: data.id as string, generation: data.generation === true }
}
export async function changeRelationshipService(slug: string, relationshipId: string, input: { expectedUserId: string; requestId: string; instanceId: string; version: number; stage: string; assigneeId: string; reason: string; cashCents?: number | null; cashVersion?: number }) {
    const { workspace, user, access } = await requireWorkspacePanel(slug, "relationships")
    await requireRelationshipAccess(access, relationshipId)
    if (user.id !== input.expectedUserId || !uuid.test(input.requestId) || !uuid.test(input.instanceId) || !Number.isSafeInteger(input.version) || input.version < 1 || !isServiceStage(input.stage) || (input.assigneeId && !uuid.test(input.assigneeId)) || input.reason.length > 1000
        || (input.cashCents !== undefined && input.cashCents !== null && (!Number.isSafeInteger(input.cashCents) || input.cashCents < 0 || input.cashCents > 1000000000000))
        || (input.cashVersion !== undefined && (!Number.isSafeInteger(input.cashVersion) || input.cashVersion < 0))) return { ok: false, error: "Check the service change and cash collected." }
    const instance = await supabaseAdmin.from("relationship_service_instances").select("relationship_id,service_id,origin,stage,assignee_user_id").eq("workspace_id", workspace.id).eq("id", input.instanceId).single()
    if (instance.error || instance.data.relationship_id !== relationshipId) return { ok: false, error: "Service not found." }
    const completedCashEdit = instance.data.origin === "already_onboarded" && instance.data.stage === "completed" && input.stage === "completed" && input.cashVersion !== undefined
    const serviceChanged = instance.data.stage !== input.stage || (instance.data.assignee_user_id ?? "") !== input.assigneeId
    if ((serviceChanged || !completedCashEdit) && !input.reason.trim()) return { ok: false, error: "Give a reason for the service change." }
    if (!completedCashEdit && (input.cashCents !== undefined || input.cashVersion !== undefined)) return { ok: false, error: "Cash collected is available only for completed historical services." }
    const result = completedCashEdit
        ? await supabaseAdmin.rpc("edit_completed_relationship_service_with_cash", { p_workspace_id: workspace.id, p_relationship_id: relationshipId, p_instance_id: input.instanceId, p_actor_user_id: user.id, p_request_id: input.requestId, p_expected_instance_version: input.version, p_stage: input.stage, p_assignee_user_id: input.assigneeId || null, p_reason: input.reason.trim(), p_expected_cash_version: input.cashVersion, p_cash_cents: input.cashCents ?? null })
        : await (async () => { const { sopWorkConfiguration } = await import("@/lib/sops/work-worker"); return supabaseAdmin.rpc("change_relationship_service_with_sop", { p_workspace_id: workspace.id, p_relationship_id: relationshipId, p_instance_id: input.instanceId, p_actor_user_id: user.id, p_request_id: input.requestId, p_expected_version: input.version, p_stage: input.stage, p_disposition: "active", p_assignee_user_id: input.assigneeId || null, p_reason: input.reason.trim(), p_generation_enabled: sopWorkConfiguration().ready }) })()
    const { data, error } = result
    if (error) return { ok: false, uncertain: !/^[0-9A-Z]{5}$/.test(error.code ?? ""), error: error.code === "P0001" ? error.message : "The save could not be confirmed. Retry this change." }
    if (input.stage === "setup") after(async () => { const { processSopWork } = await import("@/lib/sops/work-worker"); await processSopWork(undefined, input.instanceId) })
    // Keep the initiating dialog mounted while the durable job runs.
    // The worker invalidates published work; the dialog fetches the queue before closing.
    if (!data.generation) {
        revalidatePath(`/${slug}/relationships`)
        revalidatePath(`/${slug}/relationships/${relationshipId}`)
    }
    return { ok: true, id: input.instanceId, generation: data.generation === true }
}

export async function cancelRelationshipService(slug: string, relationshipId: string, input: { expectedUserId: string; requestId: string; instanceId: string; version: number; reason: string }) {
    const { workspace, user, access } = await requireWorkspacePanel(slug, "relationships")
    await requireRelationshipAccess(access, relationshipId)
    const reason = input.reason.trim()
    if (user.id !== input.expectedUserId || !uuid.test(input.requestId) || !uuid.test(input.instanceId)
        || !Number.isSafeInteger(input.version) || input.version < 1 || !reason || reason.length > 1000) {
        return { ok: false, error: "Give a reason for cancelling this service." }
    }
    const { error } = await supabaseAdmin.rpc("cancel_relationship_service", {
        p_workspace_id: workspace.id, p_relationship_id: relationshipId, p_instance_id: input.instanceId,
        p_actor_user_id: user.id, p_request_id: input.requestId, p_expected_version: input.version, p_reason: reason,
    })
    if (error) return { ok: false, uncertain: !/^[0-9A-Z]{5}$/.test(error.code ?? ""), error: error.code === "P0001" ? error.message : "Cancellation could not be confirmed. Retry this same request." }
    revalidatePath(`/${slug}/relationships`)
    revalidatePath(`/${slug}/relationships/${relationshipId}`)
    revalidatePath(`/${slug}/work-items`)
    return { ok: true }
}
