import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

const roleRank: Record<WorkspaceRole, number> = {
    member: 1,
    admin: 2,
    owner: 3,
}

export function isValidWorkspaceSlug(value: string) {
    return /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/.test(value)
}

export async function getCurrentUser() {
    const supabase = await createSupabaseServerClient()
    const { data } = await supabase.auth.getUser()
    return data.user
}

export async function requireWorkspace(
    slug: string,
    minimumRole: WorkspaceRole = "member"
) {
    const supabase = await createSupabaseServerClient()
    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user
    if (!user) redirect("/login")

    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (assurance?.currentLevel !== "aal2") redirect("/mfa")

    const { data: membership } = await supabaseAdmin
        .from("workspace_memberships")
        .select("role, workspaces!inner(id, name, slug, status, banner_path, logo_path, banner_height, banner_position)")
        .eq("user_id", user.id)
        .eq("workspaces.slug", slug)
        .maybeSingle()

    const workspace = membership?.workspaces as unknown as {
        id: string
        name: string
        slug: string
        status: "active" | "suspended"
        banner_path: string | null
        logo_path: string | null
        banner_height: number
        banner_position: number
    } | null

    if (
        !membership ||
        !workspace ||
        workspace.status !== "active" ||
        roleRank[membership.role as WorkspaceRole] < roleRank[minimumRole]
    ) {
        redirect("/workspaces")
    }

    return { user, workspace, role: membership.role as WorkspaceRole }
}

export async function getWorkspaceForPublicOnboarding(slug: string) {
    const supabase = await createSupabaseServerClient()
    const { data } = await supabase
        .from("workspaces")
        .select("id, slug, name, status")
        .eq("slug", slug)
        .eq("status", "active")
        .maybeSingle()
    return data
}
