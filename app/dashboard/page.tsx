import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseAdmin } from "@/lib/supabase/admin"

export default async function DashboardIndex() {
    const supabase = await createSupabaseServerClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) redirect("/login")

    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (assurance?.currentLevel !== "aal2") redirect("/mfa")

    const { data: memberships } = await supabaseAdmin
        .from("workspace_memberships")
        .select("workspaces!inner(slug, status)")
        .eq("user_id", userData.user.id)

    const active = (memberships ?? []).filter(
        (membership) =>
            (membership.workspaces as unknown as { status: string }).status ===
            "active"
    )
    if (active.length === 1) {
        redirect(
            `/dashboard/${(active[0].workspaces as unknown as { slug: string }).slug}`
        )
    }
    const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("username")
        .eq("user_id", userData.user.id)
        .maybeSingle()
    redirect(profile ? `/users/${profile.username}` : "/login")
}
