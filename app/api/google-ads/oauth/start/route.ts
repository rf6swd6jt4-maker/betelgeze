import { NextResponse } from "next/server"
import { OAUTH_ORIGIN, oauthCookieName, startOAuth } from "@/lib/google-ads/oauth-server"
import { googleAdsHeaders, googleAdsReply } from "@/lib/google-ads/http"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(request: Request) {
    try {
        const url = new URL(request.url)
        if (url.origin !== OAUTH_ORIGIN) throw new Error("Open Google sign-in from your portal or onboarding.")
        const state = url.searchParams.get("state") ?? ""
        const result = await startOAuth(state)
        const response = NextResponse.redirect(result.url, { headers: googleAdsHeaders })
        response.cookies.set(oauthCookieName(state), result.browser, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 })
        return response
    } catch (error) { return googleAdsReply({ error: error instanceof Error ? error.message : "Google sign-in could not be started." }, 400) }
}
