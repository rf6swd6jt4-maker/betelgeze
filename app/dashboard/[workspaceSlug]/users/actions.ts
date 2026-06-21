"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace, WORKSPACE_ROLES, type WorkspaceRole } from "@/lib/workspaces"

function roleFromForm(value: FormDataEntryValue | null): WorkspaceRole {
    if (typeof value !== "string" || !WORKSPACE_ROLES.includes(value as WorkspaceRole)) throw new Error("Invalid role")
    return value as WorkspaceRole
}

async function requireOwner(slug: string) {
    return requireWorkspace(slug, "owner")
}

export async function inviteWorkspaceUser(slug: string, formData: FormData) {
    const { workspace } = await requireOwner(slug)
    const email = String(formData.get("email") ?? "").trim().toLowerCase()
    const role = roleFromForm(formData.get("role"))
    if (!email) throw new Error("Email is required")
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/login`,
    })
    if (error || !data.user) throw new Error(error?.message ?? "Could not invite user")
    const { error: membershipError } = await supabaseAdmin.from("workspace_memberships").upsert({ workspace_id: workspace.id, user_id: data.user.id, role })
    if (membershipError) throw new Error(membershipError.message)
    revalidatePath(`/dashboard/${slug}/users`)
}

export async function updateWorkspaceUserRole(slug: string, formData: FormData) {
    const { workspace } = await requireOwner(slug)
    const userId = String(formData.get("userId") ?? "")
    const role = roleFromForm(formData.get("role"))
    const { data: member } = await supabaseAdmin.from("workspace_memberships").select("role").eq("workspace_id", workspace.id).eq("user_id", userId).maybeSingle()
    if (!member) throw new Error("User is not in this workspace")
    if (member.role === "owner" && role !== "owner") {
        const { count } = await supabaseAdmin.from("workspace_memberships").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("role", "owner")
        if ((count ?? 0) <= 1) throw new Error("A workspace must keep at least one owner")
    }
    await supabaseAdmin.from("workspace_memberships").update({ role }).eq("workspace_id", workspace.id).eq("user_id", userId)
    revalidatePath(`/dashboard/${slug}/users`)
}

export async function removeWorkspaceUser(slug: string, formData: FormData) {
    const { workspace, user } = await requireOwner(slug)
    const userId = String(formData.get("userId") ?? "")
    if (userId === user.id) throw new Error("Use another owner to remove yourself")
    const { data: member } = await supabaseAdmin.from("workspace_memberships").select("role").eq("workspace_id", workspace.id).eq("user_id", userId).maybeSingle()
    if (member?.role === "owner") {
        const { count } = await supabaseAdmin.from("workspace_memberships").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("role", "owner")
        if ((count ?? 0) <= 1) throw new Error("A workspace must keep at least one owner")
    }
    await supabaseAdmin.from("workspace_memberships").delete().eq("workspace_id", workspace.id).eq("user_id", userId)
    revalidatePath(`/dashboard/${slug}/users`)
}

export async function returnToDashboard(slug: string) { redirect(`/dashboard/${slug}`) }
