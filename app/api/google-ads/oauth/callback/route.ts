import { NextResponse } from "next/server"
import { callbackOAuth, OAUTH_ORIGIN } from "@/lib/google-ads/oauth-server"
import { googleAdsHeaders, googleAdsReply } from "@/lib/google-ads/http"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60
export async function GET(request: Request) {
    const url = new URL(request.url), state = url.searchParams.get("state") ?? ""
    try {
        if (url.origin !== OAUTH_ORIGIN) throw new Error("Invalid callback address.")
        await callbackOAuth(state, url.searchParams.get("code"), url.searchParams.has("error"))
        return NextResponse.redirect(`${OAUTH_ORIGIN}/onboarding/google-ads/connect/${state}`, { headers: googleAdsHeaders })
    } catch {
        if (url.origin === OAUTH_ORIGIN && /^[A-Za-z0-9_-]{43}$/.test(state)) return NextResponse.redirect(`${OAUTH_ORIGIN}/onboarding/google-ads/connect/${state}`, { headers: googleAdsHeaders })
        return googleAdsReply({ error: "Google sign-in could not be completed. Close this window and try again from your portal or onboarding. Check that your Google account is allowed to use this OAuth app and has Google Ads access." }, 400) }
}
