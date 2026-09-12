import { loadPortalGoogleAds, runPortalGoogleAds, portalGoogleAdsReport } from "@/lib/client-portal/google-ads-server"
import { googleAdsBody, googleAdsReply } from "@/lib/google-ads/http"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60
async function handle(request: Request, context: { params: Promise<{ token: string }> }) {
    try {
        const { token } = await context.params
        if (request.method === "GET") {
            const period = new URL(request.url).searchParams.get("period")
            return googleAdsReply(period ? await portalGoogleAdsReport(token, period, false) : await loadPortalGoogleAds(token))
        }
        const body = await googleAdsBody(request)
        if (body.action === "refresh") return googleAdsReply(await portalGoogleAdsReport(token, body.period, true))
        if ((body.action !== "request" && body.action !== "verify") || typeof body.customerId !== "string") return googleAdsReply({ error: "Choose whether to request or verify access." }, 400)
        if (body.action === "request" && body.consented !== true) return googleAdsReply({ error: "Confirm you are authorised to connect this account." }, 400)
        return googleAdsReply({ connection: await runPortalGoogleAds(token, body.customerId, body.action === "request") })
    } catch (error) { return googleAdsReply({ error: error instanceof Error ? error.message : "Google Ads could not be loaded. Please retry." }, 400) }
}
export { handle as GET, handle as POST }
