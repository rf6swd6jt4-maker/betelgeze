import "server-only"
import { MAINTENANCE_CATEGORIES, maintenanceCategoryLabel } from "@/lib/admin/maintenance"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { loadWorkspaceMemberProfiles } from "@/lib/teams/server"

export async function loadWorkspaceOperations(workspaceId: string) {
    const [people, roles, eligible, services, maintenance] = await Promise.all([
        loadWorkspaceMemberProfiles(workspaceId),
        supabaseAdmin.from("workspace_operational_roles").select("user_id, can_sell, can_manage").eq("workspace_id", workspaceId),
        supabaseAdmin.from("workspace_member_service_access").select("service_id, user_id").eq("workspace_id", workspaceId),
        supabaseAdmin.from("onboarding_service_revisions").select("service_id, name, revision_number").eq("workspace_id", workspaceId).order("revision_number", { ascending: false }),
        supabaseAdmin.from("workspace_maintenance_routing").select("category, responsible_user_id").eq("workspace_id", workspaceId),
    ])
    for (const result of [roles, eligible, services, maintenance]) if (result.error) throw new Error(result.error.message)
    const roleById = new Map((roles.data ?? []).map((row) => [row.user_id, row]))
    const serviceNames = new Map<string, string>()
    for (const revision of services.data ?? []) if (!serviceNames.has(revision.service_id)) serviceNames.set(revision.service_id, revision.name)
    return {
        maintenance: MAINTENANCE_CATEGORIES.map((key) => ({ key, label: maintenanceCategoryLabel(key), userId: maintenance.data?.find((r) => r.category === key)?.responsible_user_id ?? "" })),
        people: people.map((person) => ({ ...person, canSell: roleById.get(person.id)?.can_sell ?? false, canManage: roleById.get(person.id)?.can_manage ?? false })),
        eligible: eligible.data ?? [],
        services: [...serviceNames].map(([id, name]) => ({ id, name })),
    }
}
export type WorkspaceOperations = Awaited<ReturnType<typeof loadWorkspaceOperations>>
