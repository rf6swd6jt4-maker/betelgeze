import { redirect } from "next/navigation"
import { redirectToLogin } from "@/lib/auth/server-redirects"
import { getVerifiedUser } from "@/lib/auth/verified-user"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseAdmin } from "@/lib/supabase/admin"

export default async function WorkspacesRedirectPage() {
    const supabase = await createSupabaseServerClient()
    const user = await getVerifiedUser(supabase)
    if (!user) return await redirectToLogin()

    const { data: memberships } = await supabaseAdmin
        .from("workspace_memberships")
        .select("workspaces!inner(slug, status)")
        .eq("user_id", user.id)

    const active = (memberships ?? []).filter(
        (membership) =>
            (membership.workspaces as unknown as { status: string }).status ===
            "active"
    )
    if (active.length === 1) {
        redirect(`/${(active[0].workspaces as unknown as { slug: string }).slug}`)
    }

    const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("username")
        .eq("user_id", user.id)
        .maybeSingle()
    if (!profile) return await redirectToLogin()
    redirect(`/users/${profile.username}`)
}
