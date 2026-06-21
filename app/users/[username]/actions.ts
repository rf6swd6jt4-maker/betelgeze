"use server"

import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getCurrentUser } from "@/lib/workspaces"

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
