import { redirect } from "next/navigation"
import { redirectToLogin } from "@/lib/auth/server-redirects"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseAdmin } from "@/lib/supabase/admin"

export default async function WorkspacesRedirectPage() {
    const supabase = await createSupabaseServerClient()
    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user
    if (!user) return await redirectToLogin()
    const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("username")
        .eq("user_id", user.id)
        .maybeSingle()
    if (!profile) return await redirectToLogin()
    redirect(`/users/${profile.username}`)
}
