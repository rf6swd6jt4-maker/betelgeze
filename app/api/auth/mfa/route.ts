import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"

function jsonWithSessionCookies<T>(sessionResponse: NextResponse, body: T, init?: ResponseInit) {
    const response = NextResponse.json(body, init)
    sessionResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
    return response
}

export async function GET(request: NextRequest) {
    const sessionResponse = NextResponse.json({ verified: false })
    const supabase = createSupabaseRouteClient(request, sessionResponse)
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) return jsonWithSessionCookies(sessionResponse, { error: error.message }, { status: 401 })
    const pending = data?.all.find((factor) => factor.factor_type === "totp" && factor.status === "unverified")
    return jsonWithSessionCookies(sessionResponse, { verified: Boolean(data?.totp.some((factor) => factor.status === "verified")), pendingFactorId: pending?.id ?? null })
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
    if (factorError) return jsonWithSessionCookies(response, { error: factorError.message }, { status: 401 })

    if (action === "setup") {
        const pending = factorData?.all.find((factor) => factor.factor_type === "totp" && factor.status === "unverified")
        if (pending) return jsonWithSessionCookies(response, { factorId: pending.id, pending: true })
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Betelgeze" })
        if (error) return jsonWithSessionCookies(response, { error: "We could not start authenticator setup. If you already scanned a code, enter its current code to finish setup." }, { status: 400 })
        return jsonWithSessionCookies(response, { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    }

    if (action === "reset-setup") {
        const pending = factorData?.all.find((factor) => factor.factor_type === "totp" && factor.status === "unverified")
        if (!pending) return jsonWithSessionCookies(response, { cleared: true })
        const { error } = await supabase.auth.mfa.unenroll({ factorId: pending.id })
        if (error) return jsonWithSessionCookies(response, { error: "We could not clear the unfinished authenticator setup. Please try again." }, { status: 400 })
        return jsonWithSessionCookies(response, { cleared: true })
    }

    if (!/^\d{6}$/.test(code)) return jsonWithSessionCookies(response, { error: "Enter a valid six-digit authentication code." }, { status: 400 })

    const factor = factorId
        ? factorData?.all.find((item) => item.id === factorId && item.factor_type === "totp")
        : factorData?.totp.find((item) => item.status === "verified")
    if (!factor) {
        return jsonWithSessionCookies(response, { error: "Your unfinished authenticator setup could not be found. Start again with a new QR code." }, { status: 403 })
    }

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id })
    if (challengeError) return jsonWithSessionCookies(response, { error: "We could not check that authenticator yet. Please try again." }, { status: 400 })

    const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code,
    })
    if (verifyError) return jsonWithSessionCookies(response, { error: "That code did not match. Check your authenticator and try again, or start over with a new QR code." }, { status: 401 })

    return response
}
