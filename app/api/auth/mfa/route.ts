import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"

export async function POST(request: NextRequest) {
    let code = ""
    try {
        ({ code = "" } = await request.json())
    } catch {
        return NextResponse.json({ error: "Enter your six-digit authentication code." }, { status: 400 })
    }

    if (!/^\d{6}$/.test(code)) {
        return NextResponse.json({ error: "Enter a valid six-digit authentication code." }, { status: 400 })
    }

    const response = NextResponse.json({ ok: true })
    const supabase = createSupabaseRouteClient(request, response)
    const { data: factorData, error: factorError } = await supabase.auth.mfa.listFactors()
    if (factorError) return NextResponse.json({ error: factorError.message }, { status: 401 })

    const factor = factorData?.totp.find((item) => item.status === "verified")
    if (!factor) {
        return NextResponse.json({ error: "No verified authenticator is configured for this account." }, { status: 403 })
    }

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id })
    if (challengeError) return NextResponse.json({ error: challengeError.message }, { status: 400 })

    const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code,
    })
    if (verifyError) return NextResponse.json({ error: verifyError.message }, { status: 401 })

    return response
}
