"use server"
import { revalidatePath } from "next/cache"
import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { isServiceStage } from "@/lib/service-stages"
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
export async function addRelationshipService(slug: string, relationshipId: string, input: { requestId: string; expectedUserId: string; serviceId: string; revisionId: string; origin: string; stage: string; assigneeId: string }) {
    const { workspace, user, access } = await requireWorkspacePanel(slug, "relationships")
    await requireRelationshipAccess(access, relationshipId)
    if (user.id !== input.expectedUserId || !uuid.test(input.requestId) || !uuid.test(input.serviceId) || !uuid.test(input.revisionId) || (input.assigneeId && !uuid.test(input.assigneeId))
        || !((input.origin === "negotiation" && input.stage === "negotiating") || (input.origin === "already_onboarded" && ["setup", "maintenance", "completed"].includes(input.stage)))) return { ok: false, error: "Check the service and starting stage." }
    const { data, error } = await supabaseAdmin.rpc("add_relationship_service", { p_workspace_id: workspace.id, p_relationship_id: relationshipId, p_actor_user_id: user.id, p_request_id: input.requestId, p_service_id: input.serviceId, p_revision_id: input.revisionId, p_origin: input.origin, p_stage: input.stage, p_assignee_user_id: input.assigneeId || null })
    if (error) return { ok: false, uncertain: !/^[0-9A-Z]{5}$/.test(error.code ?? ""), error: error.code === "P0001" ? error.message : "The save could not be confirmed. Retry to recover this same service." }
    revalidatePath(`/${slug}/relationships`)
    revalidatePath(`/${slug}/relationships/${relationshipId}`)
    return { ok: true, id: data as string }
}
export async function changeRelationshipService(slug: string, relationshipId: string, input: { expectedUserId: string; requestId: string; instanceId: string; version: number; stage: string; assigneeId: string; reason: string }) {
    const { workspace, user, access } = await requireWorkspacePanel(slug, "relationships")
    await requireRelationshipAccess(access, relationshipId)
    if (user.id !== input.expectedUserId || !uuid.test(input.requestId) || !uuid.test(input.instanceId) || !Number.isSafeInteger(input.version) || input.version < 1 || !isServiceStage(input.stage) || (input.assigneeId && !uuid.test(input.assigneeId)) || !input.reason.trim() || input.reason.length > 1000) return { ok: false, error: "Check the service change and give a reason." }
    const instance = await supabaseAdmin.from("relationship_service_instances").select("relationship_id").eq("workspace_id", workspace.id).eq("id", input.instanceId).single()
    if (instance.error || instance.data.relationship_id !== relationshipId) return { ok: false, error: "Service not found." }
    const { error } = await supabaseAdmin.rpc("change_service_instance", { p_workspace_id: workspace.id, p_instance_id: input.instanceId, p_actor_user_id: user.id, p_request_id: input.requestId, p_expected_version: input.version, p_stage: input.stage, p_disposition: "active", p_assignee_user_id: input.assigneeId || null, p_reason: input.reason.trim() })
    if (error) return { ok: false, uncertain: !/^[0-9A-Z]{5}$/.test(error.code ?? ""), error: error.code === "P0001" ? error.message : "The save could not be confirmed. Retry this change." }
    revalidatePath(`/${slug}/relationships`)
    revalidatePath(`/${slug}/relationships/${relationshipId}`)
    return { ok: true }
}
