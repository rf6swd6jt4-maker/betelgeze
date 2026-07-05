import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { findAuthUserByEmail, isEmailConfirmed } from "@/lib/auth/users"
import { getRequiredEnv } from "@/lib/env"

const authOrigin = "https://auth.betelgeze.com"

function authOriginForRequest(request: NextRequest) {
    const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.split(":")[0]?.toLowerCase()
    return host === "app.betelgeze.com" ? "https://app.betelgeze.com" : authOrigin
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null)
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : ""
    const invite = typeof body?.invite === "string" && body.invite ? body.invite : null

    if (!email || !email.includes("@")) {
        return NextResponse.json({ error: "Enter the email address you used to create the account." }, { status: 400 })
    }

    const user = await findAuthUserByEmail(email)
    if (!user) {
        return NextResponse.json({ error: "No pending Betelgeze account exists for that email. Start the invitation signup again." }, { status: 404 })
    }
    if (isEmailConfirmed(user)) {
        return NextResponse.json({ error: "That email is already confirmed. Log in instead." }, { status: 409 })
    }

    const confirmationNext = invite ? `/confirmed?invite=${encodeURIComponent(invite)}` : "/confirmed"
    const supabase = createClient(
        getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
        getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
        { auth: { persistSession: false, autoRefreshToken: false } }
    )

    const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${authOriginForRequest(request)}/auth/callback?next=${encodeURIComponent(confirmationNext)}` },
    })

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
}
