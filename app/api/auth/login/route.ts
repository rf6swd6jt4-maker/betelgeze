import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createSupabaseRouteClient } from "@/lib/supabase/route"
import { clearLegacyHostOnlyAuthCookies } from "@/lib/supabase/legacy-cookies"

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null); const identifier = typeof body?.identifier === "string" ? body.identifier.trim().toLowerCase() : ""; const password = typeof body?.password === "string" ? body.password : ""
    if (!identifier || !password) return NextResponse.json({ error: "Invalid login credentials." }, { status: 400 })
    let email = identifier
    if (!identifier.includes("@")) { const { data: profile } = await supabaseAdmin.from("user_profiles").select("user_id").eq("username", identifier).maybeSingle(); if (!profile) return NextResponse.json({ error: "Invalid login credentials." }, { status: 401 }); const { data } = await supabaseAdmin.auth.admin.getUserById(profile.user_id); email = data.user?.email ?? "" }
    const response = NextResponse.json({ ok: true }); const { error } = await createSupabaseRouteClient(request, response).auth.signInWithPassword({ email, password })
    if (error) {
        if (error.message.toLowerCase().includes("email not confirmed")) return NextResponse.json({ error: "Confirm your email before logging in.", code: "email_unconfirmed", email }, { status: 403 })
        return NextResponse.json({ error: "Invalid login credentials." }, { status: 401 })
    }
    clearLegacyHostOnlyAuthCookies(request, response)
    return response
}
