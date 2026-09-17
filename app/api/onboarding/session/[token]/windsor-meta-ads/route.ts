import { checkWindsorMetaAdsOnboarding, loadWindsorMetaAdsOnboarding } from "@/lib/onboarding/windsor-meta-ads-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }
type Context = { params: Promise<{ token: string }> }

export async function GET(request: Request, { params }: Context) {
    try {
        const { token } = await params
        const block = new URL(request.url).searchParams.get("block") || ""
        return Response.json({ ok: true, ...await loadWindsorMetaAdsOnboarding(token, block) }, { headers })
    } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : "Your connection could not be loaded." }, { status: 400, headers })
    }
}

export async function POST(request: Request, { params }: Context) {
    const origin = request.headers.get("origin")
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
        return Response.json({ ok: false, error: "Invalid request origin." }, { status: 403, headers })
    }
    try {
        const { token } = await params
        const block = new URL(request.url).searchParams.get("block") || ""
        const accountId = new URL(request.url).searchParams.get("account")
        if (accountId && accountId.length > 200) throw new Error("Choose a valid Meta Ads account.")
        return Response.json({ ok: true, ...await checkWindsorMetaAdsOnboarding(token, block, accountId) }, { headers })
    } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : "Your connection could not be confirmed." }, { status: 400, headers })
    }
}
