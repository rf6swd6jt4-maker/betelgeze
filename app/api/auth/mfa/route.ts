import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"

export async function GET(request: NextRequest) {
    const response = NextResponse.json({ verified: false })
    const supabase = createSupabaseRouteClient(request, response)
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) return NextResponse.json({ error: error.message }, { status: 401 })
    return NextResponse.json({ verified: Boolean(data?.totp.some((factor) => factor.status === "verified")) })
}

export async function POST(request: NextRequest) {
    let code = ""
    let action = "verify"
    let factorId = ""
    try {
        ({ code = "", action = "verify", factorId = "" } = await request.json())
    } catch {
        return NextResponse.json({ error: "Enter your six-digit authentication code." }, { status: 400 })
    }

    const response = NextResponse.json({ ok: true })
    const supabase = createSupabaseRouteClient(request, response)
    const { data: factorData, error: factorError } = await supabase.auth.mfa.listFactors()
    if (factorError) return NextResponse.json({ error: factorError.message }, { status: 401 })

    if (action === "setup") {
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Betelgeze" })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    }

    if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: "Enter a valid six-digit authentication code." }, { status: 400 })

    const factor = factorId
        ? factorData?.totp.find((item) => item.id === factorId)
        : factorData?.totp.find((item) => item.status === "verified")
    if (!factor) {
        return NextResponse.json({ error: "Set up an authenticator before continuing." }, { status: 403 })
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
