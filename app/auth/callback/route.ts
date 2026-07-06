import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"
import { clearLegacyHostOnlyAuthCookies } from "@/lib/supabase/legacy-cookies"

export async function GET(request: NextRequest) {
    const url = request.nextUrl
    const code = url.searchParams.get("code")
    const tokenHash = url.searchParams.get("token_hash")
    const type = url.searchParams.get("type")
    const confirmedRedirect = url.searchParams.get("confirmed_redirect") === "1"
    const requestedNext = url.searchParams.get("next") || "/confirmed"
    const suiteNext = /^https:\/\/(app|dashboard|onboarding|leadgen)\.betelgeze\.com(?:\/|$)/.test(requestedNext)
    const next = suiteNext ? requestedNext : requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/dashboard"
    const response = NextResponse.redirect(new URL(next, url.origin))

    if (code || tokenHash) {
        const supabase = createSupabaseRouteClient(request, response)
        const { error } = code
            ? await supabase.auth.exchangeCodeForSession(code)
            : type === "signup"
                ? await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: "signup" })
                : { error: new Error("Unsupported confirmation link.") }

        if (error) {
            if (next === "/confirmed" || next.startsWith("/confirmed?")) {
                const confirmed = new URL("/confirmed", url.origin)
                confirmed.searchParams.set(confirmedRedirect ? "status" : "error", confirmedRedirect ? "confirmed" : "confirmation_failed")
                response.headers.set("location", confirmed.toString())
            }
            return response
        }

        const { data } = await supabase.auth.getUser()
        clearLegacyHostOnlyAuthCookies(request, response)
        if (next === "/login" || next === "/confirmed" || next.startsWith("/confirmed?")) {
            const confirmed = new URL("/confirmed", url.origin)
            confirmed.searchParams.set("email", data.user?.email ?? "")
            const invite = new URL(next, url.origin).searchParams.get("invite")
            if (invite) confirmed.searchParams.set("invite", invite)
            response.headers.set("location", confirmed.toString())
        }
    }

    return response
}
