"use server"

import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getCurrentUser } from "@/lib/workspaces"

const usernamePattern = /^[a-z0-9][a-z0-9-]{1,27}[a-z0-9]$/

export async function updateUsername(_: { error?: string; username?: string }, formData: FormData) {
    const user = await getCurrentUser()
    if (!user) redirect("/login")
    const username = String(formData.get("username") ?? "").trim().toLowerCase()
    if (!usernamePattern.test(username)) return { error: "Use 3–30 lowercase letters, numbers, or hyphens." }
    const { error } = await supabaseAdmin.from("user_profiles").update({ username }).eq("user_id", user.id)
    if (error) return { error: error.code === "23505" ? "That username is already taken." : "We could not update your username. Please try again." }
    return { username }
}

export async function createWorkspace(username: string, formData: FormData) {
    const user = await getCurrentUser()
    if (!user) redirect("/login")
    const name = String(formData.get("name") ?? "").trim()
    const slug = String(formData.get("slug") ?? "").trim().toLowerCase()
    if (name.length < 2 || !/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/.test(slug)) throw new Error("Choose a workspace name and a valid URL slug.")
    const { data: workspace, error } = await supabaseAdmin.from("workspaces").insert({ name, slug }).select("id, slug").single()
    if (error || !workspace) throw new Error(error?.code === "23505" ? "That dashboard URL is already taken." : "Could not create dashboard.")
    await supabaseAdmin.from("workspace_memberships").insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" })
    redirect(`/dashboard/${workspace.slug}`)
}

export async function leaveWorkspace(username: string, formData: FormData) {
    const user = await getCurrentUser()
    if (!user) redirect("/login")
    const workspaceId = String(formData.get("workspaceId") ?? "")
    const { data: membership } = await supabaseAdmin
        .from("workspace_memberships")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
        .maybeSingle()
    if (!membership) throw new Error("You are not a member of this workspace")
    if (membership.role === "owner") {
        const { count } = await supabaseAdmin
            .from("workspace_memberships")
            .select("*", { count: "exact", head: true })
            .eq("workspace_id", workspaceId)
            .eq("role", "owner")
        if ((count ?? 0) <= 1) {
            throw new Error("Transfer ownership before leaving your only-owner workspace")
        }
    }
    await supabaseAdmin
        .from("workspace_memberships")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("user_id", user.id)
    redirect(`/users/${username}`)
}
