"use server"
import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import type { WorkspaceCapability } from "@/lib/workspace-capabilities"

export async function saveWorkspaceOperations(slug: string, people: Array<{ userId: string; canSell: boolean; canManage: boolean }>, permissions: Record<string, WorkspaceCapability[]>) {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        const { error } = await supabaseAdmin.rpc("save_workspace_operations", { p_workspace_id: workspace.id, p_actor_user_id: user.id, p_people: people, p_permissions: permissions })
        if (error) throw new Error(error.message)
        revalidatePath(`/${slug}`, "layout")
        return { ok: true as const }
    } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Could not save operational roles." } }
}
export async function saveServiceDeliveryUsers(slug: string, serviceId: string, userIds: string[]) {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        const { error } = await supabaseAdmin.rpc("set_service_delivery_users", { p_workspace_id: workspace.id, p_actor_user_id: user.id, p_service_id: serviceId, p_user_ids: [...new Set(userIds)] })
        if (error) throw new Error(error.message)
        revalidatePath(`/${slug}`, "layout")
        return { ok: true as const }
    } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Could not save service eligibility." } }
}

export async function saveMaintenanceAssignments(slug: string, assignments: Record<string, string>) {
    try {
        const { workspace, user } = await requireWorkspace(slug, "owner")
        const { error } = await supabaseAdmin.rpc("save_workspace_maintenance_assignments", { p_workspace_id: workspace.id, p_actor_user_id: user.id, p_assignments: assignments })
        if (error) throw new Error(error.message)
        revalidatePath(`/${slug}`, "layout")
        return { ok: true as const }
    } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Could not save maintenance assignments." } }
}
