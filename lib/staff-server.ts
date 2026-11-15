import "server-only"
import { footprintPeopleIds, parseFootprint, type MemberFootprintResponse, type StaffWorkloadRow } from "@/lib/member-offboarding"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"

const MISSING_FUNCTION = new Set(["PGRST202", "42883"])

async function profiles(ids: string[]) {
    if (!ids.length) return new Map<string, { name: string; avatarSrc: string | null }>()
    const { data, error } = await supabaseAdmin.from("user_profiles").select("user_id, username, display_name, avatar_path").in("user_id", ids)
    if (error) throw new Error("Could not load people's names.")
    return new Map((data ?? []).map(profile => [profile.user_id, {
        name: profile.display_name?.trim() || profile.username || "Workspace member",
        avatarSrc: profile.avatar_path && profile.username ? profileAvatarUrl(profile.username, profile.avatar_path) : null,
    }]))
}

/** People in the workspace with what each currently holds. Null when the database update is not applied yet. */
export async function loadStaffWorkload(workspaceId: string, actorId: string): Promise<StaffWorkloadRow[] | null> {
    const { data, error } = await supabaseAdmin.rpc("workspace_member_workload", { p_workspace: workspaceId, p_actor: actorId })
    if (error && MISSING_FUNCTION.has(error.code ?? "")) return null
    if (error) throw new Error(error.code === "P0001" ? error.message : "Could not load the team.")
    const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>
    const names = await profiles(rows.map(row => String(row.userId)))
    return rows.map(row => {
        const id = String(row.userId)
        return {
            userId: id, name: names.get(id)?.name ?? "Workspace member", avatarSrc: names.get(id)?.avatarSrc ?? null,
            role: String(row.role ?? "staff"), joinedAt: typeof row.joinedAt === "string" ? row.joinedAt : null,
            clients: Number(row.clients ?? 0), services: Number(row.services ?? 0), queues: Number(row.queues ?? 0), tasks: Number(row.tasks ?? 0),
        }
    }).sort((left, right) => left.name.localeCompare(right.name))
}

/** Everything one person holds, with eligible people's names. Shared by the Staff detail page and the footprint route. */
export async function loadMemberFootprint(workspaceId: string, actorId: string, targetId: string): Promise<MemberFootprintResponse> {
    const { data, error } = await supabaseAdmin.rpc("preview_workspace_member_footprint", {
        p_workspace: workspaceId, p_actor: actorId, p_target: targetId, p_service: null,
    })
    if (error && MISSING_FUNCTION.has(error.code ?? "")) return { available: false }
    if (error) throw new Error(error.code === "P0001" ? error.message : "Could not load this person's assignments.")
    const ids = [...new Set([targetId, ...footprintPeopleIds(data)])]
    const names = await profiles(ids)
    const people: Record<string, string> = {}
    for (const id of ids) if (id !== targetId) people[id] = names.get(id)?.name ?? "Workspace member"
    const footprint = parseFootprint(data, targetId, people, names.get(targetId)?.name ?? "Workspace member")
    if (!footprint) throw new Error("This person's assignments could not be read.")
    return footprint
}
