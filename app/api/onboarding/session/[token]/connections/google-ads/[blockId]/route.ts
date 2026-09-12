import { oauthEnabled, prepareOAuth } from "@/lib/google-ads/oauth-server"
import { loadGoogleAdsOnboarding, runGoogleAdsOnboarding } from "@/lib/onboarding/google-ads-server"
import { googleAdsBody, googleAdsReply } from "@/lib/google-ads/http"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60
async function handle(request: Request, context: { params: Promise<{ token: string; blockId: string }> }) {
    try {
        const { token, blockId } = await context.params
        if (request.method === "GET") return googleAdsReply({ ...await loadGoogleAdsOnboarding(token, blockId), oauthEnabled: oauthEnabled() })
        const body = await googleAdsBody(request)
        if (body.action === "oauth_start") return googleAdsReply(await prepareOAuth({ token, blockId }, new URL(request.url).origin))
        if ((body.action !== "request" && body.action !== "verify") || typeof body.customerId !== "string") return googleAdsReply({ error: "Choose whether to request or verify access." }, 400)
        if (body.action === "request" && body.consented !== true) return googleAdsReply({ error: "Confirm you are authorised to connect this account." }, 400)
        return googleAdsReply({ connection: await runGoogleAdsOnboarding(token, blockId, body.customerId, body.action === "request") })
    } catch (error) { return googleAdsReply({ error: error instanceof Error ? error.message : "Google Ads could not be loaded. Please retry." }, 400) }
}
export { handle as GET, handle as POST }
