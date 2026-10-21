import { loadPortalMetaAdsReport } from "@/lib/client-portal/meta-ads-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const responseHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" }

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
    return respond(context, false)
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
    if (request.headers.get("sec-fetch-site") === "cross-site" || (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers: responseHeaders })
    return respond(context, true)
}

async function respond(context: { params: Promise<{ token: string }> }, refresh: boolean) {
    const { token } = await context.params
    try {
        const report = await loadPortalMetaAdsReport(token, refresh)
        if (!report) return Response.json({ error: "Meta Ads reporting is not available for this portal." }, { status: 404, headers: responseHeaders })
        return Response.json({ report }, { headers: responseHeaders })
    } catch (error) {
        console.error("Client portal Meta Ads report", error instanceof Error ? error.message : "Unknown reporting error")
        return Response.json({ error: "Meta Ads reporting is temporarily unavailable. Please try again." }, { status: 503, headers: responseHeaders })
    }
}
