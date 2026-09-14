import { NextRequest, NextResponse } from "next/server"
import { prepareWindsorMetaAdsAuthorization } from "@/lib/onboarding/windsor-meta-ads-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    const blockId = request.nextUrl.searchParams.get("block")?.trim()
    if (!blockId) return Response.json({ error: "The Meta Ads connection block is missing." }, { status: 400, headers: { "Cache-Control": "private, no-store" } })
    try {
        const url = await prepareWindsorMetaAdsAuthorization(token, blockId)
        const response = NextResponse.redirect(url, 303)
        response.headers.set("Cache-Control", "private, no-store")
        response.headers.set("Referrer-Policy", "no-referrer")
        return response
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "The Meta Ads reporting connection could not be started." }, { status: 409, headers: { "Cache-Control": "private, no-store" } })
    }
}
