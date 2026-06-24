import { NextRequest, NextResponse } from "next/server"
import { createSupabaseRouteClient } from "@/lib/supabase/route"

export async function GET(request: NextRequest) {
    const url = request.nextUrl
    const code = url.searchParams.get("code")
    const requestedNext = url.searchParams.get("next") || "/confirmed"
    const suiteNext = /^https:\/\/(dashboard|onboarding|leadgen)\.betelgeze\.com(?:\/|$)/.test(requestedNext)
    const next = suiteNext ? requestedNext : requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/dashboard"
    const response = NextResponse.redirect(new URL(next, url.origin))

    if (code) {
        const supabase = createSupabaseRouteClient(request, response)
        await supabase.auth.exchangeCodeForSession(code)
        const { data } = await supabase.auth.getUser()
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
