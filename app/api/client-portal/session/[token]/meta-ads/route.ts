import { loadPortalMetaAdsReport } from "@/lib/client-portal/meta-ads-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const responseHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" }

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
    const { token } = await context.params
    try {
        const report = await loadPortalMetaAdsReport(token)
        if (!report) return Response.json({ error: "Meta Ads reporting is not available for this portal." }, { status: 404, headers: responseHeaders })
        return Response.json({ report }, { headers: responseHeaders })
    } catch {
        return Response.json({ error: "Meta Ads reporting is temporarily unavailable. Please try again." }, { status: 503, headers: responseHeaders })
    }
}
