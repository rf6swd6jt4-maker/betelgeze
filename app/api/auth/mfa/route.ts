import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"

export async function GET(request: NextRequest) {
    const response = NextResponse.json({ verified: false })
    const supabase = createSupabaseRouteClient(request, response)
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) return NextResponse.json({ error: error.message }, { status: 401 })
    const pending = data?.all.find((factor) => factor.factor_type === "totp" && factor.status === "unverified")
    return NextResponse.json({ verified: Boolean(data?.totp.some((factor) => factor.status === "verified")), pendingFactorId: pending?.id ?? null })
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
        const pending = factorData?.all.find((factor) => factor.factor_type === "totp" && factor.status === "unverified")
        if (pending) return NextResponse.json({ factorId: pending.id, pending: true })
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Betelgeze" })
        if (error) return NextResponse.json({ error: "We could not start authenticator setup. If you already scanned a code, enter its current code to finish setup." }, { status: 400 })
        return NextResponse.json({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    }

    if (action === "reset-setup") {
        const pending = factorData?.all.find((factor) => factor.factor_type === "totp" && factor.status === "unverified")
        if (!pending) return NextResponse.json({ cleared: true })
        const { error } = await supabase.auth.mfa.unenroll({ factorId: pending.id })
        if (error) return NextResponse.json({ error: "We could not clear the unfinished authenticator setup. Please try again." }, { status: 400 })
        return NextResponse.json({ cleared: true })
    }

    if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: "Enter a valid six-digit authentication code." }, { status: 400 })

    const factor = factorId
        ? factorData?.all.find((item) => item.id === factorId && item.factor_type === "totp")
        : factorData?.totp.find((item) => item.status === "verified")
    if (!factor) {
        return NextResponse.json({ error: "Your unfinished authenticator setup could not be found. Start again with a new QR code." }, { status: 403 })
    }

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id })
    if (challengeError) return NextResponse.json({ error: "We could not check that authenticator yet. Please try again." }, { status: 400 })

    const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code,
    })
    if (verifyError) return NextResponse.json({ error: "That code did not match. Check your authenticator and try again, or start over with a new QR code." }, { status: 401 })

    return response
}
