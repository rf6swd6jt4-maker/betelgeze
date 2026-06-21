"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace, type WorkspaceRole } from "@/lib/workspaces"

function invitedRole(value: FormDataEntryValue | null) {
    if (value === "member" || value === "admin") return value
    throw new Error("Invalid role")
}

async function requireUserManager(slug: string) {
    return requireWorkspace(slug, "admin")
}

export async function inviteWorkspaceUser(slug: string, formData: FormData) {
    const { workspace, role } = await requireUserManager(slug)
    const email = String(formData.get("email") ?? "").trim().toLowerCase()
    const requestedRole = invitedRole(formData.get("role"))
    if (!email) throw new Error("Email is required")
    if (role !== "owner" && requestedRole !== "member") {
        throw new Error("Only workspace owners can invite admins")
    }

    const { data: listed } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
    })
    const existingUser = listed.users.find(
        (user) => user.email?.toLowerCase() === email
    )
    const user = existingUser ?? (
        await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
            redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/update-password`,
        })
    ).data.user

    if (!user) throw new Error("Could not invite user")
    const { error } = await supabaseAdmin.from("workspace_memberships").upsert({
        workspace_id: workspace.id,
        user_id: user.id,
        role: requestedRole,
    })
    if (error) throw new Error(error.message)
    revalidatePath(`/dashboard/${slug}/users`)
}

export async function updateWorkspaceUserRole(slug: string, formData: FormData) {
    const { workspace, role: actingRole } = await requireUserManager(slug)
    if (actingRole !== "owner") throw new Error("Only workspace owners can change roles")
    const userId = String(formData.get("userId") ?? "")
    const role = invitedRole(formData.get("role")) as WorkspaceRole
    await supabaseAdmin
        .from("workspace_memberships")
        .update({ role })
        .eq("workspace_id", workspace.id)
        .eq("user_id", userId)
    revalidatePath(`/dashboard/${slug}/users`)
}

export async function removeWorkspaceUser(slug: string, formData: FormData) {
    const { workspace, role: actingRole } = await requireUserManager(slug)
    const userId = String(formData.get("userId") ?? "")
    const { data: target } = await supabaseAdmin
        .from("workspace_memberships")
        .select("role")
        .eq("workspace_id", workspace.id)
        .eq("user_id", userId)
        .maybeSingle()
    if (!target || target.role === "owner") throw new Error("Owners cannot be removed here")
    if (actingRole !== "owner" && target.role !== "member") {
        throw new Error("Admins can only remove members")
    }
    await supabaseAdmin
        .from("workspace_memberships")
        .delete()
        .eq("workspace_id", workspace.id)
        .eq("user_id", userId)
    revalidatePath(`/dashboard/${slug}/users`)
}
