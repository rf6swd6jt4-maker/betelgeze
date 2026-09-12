import { connectOAuth, OAUTH_ORIGIN, viewOAuth } from "@/lib/google-ads/oauth-server"
import { googleAdsBody, googleAdsReply } from "@/lib/google-ads/http"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60
async function handle(request: Request) {
    try {
        const url = new URL(request.url)
        if (url.origin !== OAUTH_ORIGIN) throw new Error("Open Google sign-in from your portal or onboarding.")
        const state = url.searchParams.get("state") ?? ""
        if (request.method === "GET") return googleAdsReply(await viewOAuth(state))
        const body = await googleAdsBody(request)
        if (typeof body.customerId !== "string") throw new Error("Choose your advertising account.")
        return googleAdsReply(await connectOAuth(state, body.customerId, body.consented === true))
    } catch (error) { return googleAdsReply({ error: error instanceof Error ? error.message : "The connection could not be completed." }, 400) }
}
export { handle as GET, handle as POST }
