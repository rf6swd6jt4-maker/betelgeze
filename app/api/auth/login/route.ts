import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
    const body = await request.json().catch(() => null)
    const identifier = typeof body?.identifier === "string" ? body.identifier.trim().toLowerCase() : ""
    const password = typeof body?.password === "string" ? body.password : ""
    if (!identifier || !password) return NextResponse.json({ error: "Invalid login credentials." }, { status: 400 })

    let email = identifier
    if (!identifier.includes("@")) {
        const { data: profile } = await supabaseAdmin.from("user_profiles").select("user_id").eq("username", identifier).maybeSingle()
        if (!profile) return NextResponse.json({ error: "Invalid login credentials." }, { status: 401 })
        const { data: userResult } = await supabaseAdmin.auth.admin.getUserById(profile.user_id)
        email = userResult.user?.email ?? ""
    }

    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return NextResponse.json({ error: "Invalid login credentials." }, { status: 401 })
    return NextResponse.json({ ok: true })
}
