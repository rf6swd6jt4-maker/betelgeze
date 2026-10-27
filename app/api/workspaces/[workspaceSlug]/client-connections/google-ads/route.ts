import { requireWorkspacePanel } from "@/lib/workspace-access"
import { loadStaffGoogleAds, runStaffGoogleAds, StaffGoogleAdsUnavailableError } from "@/lib/client-connections/google-ads-setup"
import { GoogleAdsConnectionAccessError } from "@/lib/google-ads/connection-server"
import { googleAdsBody, googleAdsReply } from "@/lib/google-ads/http"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

type Context = { params: Promise<{ workspaceSlug: string }> }
function errorReply(error: unknown) {
    const status = error instanceof GoogleAdsConnectionAccessError ? 403 : error instanceof StaffGoogleAdsUnavailableError ? 503 : 400
    return googleAdsReply({ error: error instanceof Error ? error.message : "Google Ads could not be loaded. Please retry." }, status)
}
async function actor(context: Context) {
    const { workspaceSlug } = await context.params
    try { return await requireWorkspacePanel(workspaceSlug, "client-connections") }
    catch { throw new GoogleAdsConnectionAccessError("This client Google Ads connection is unavailable.") }
}

export async function GET(request: Request, context: Context) {
    try {
        const { workspace, user } = await actor(context)
        const relationshipId = new URL(request.url).searchParams.get("relationship") ?? ""
        return googleAdsReply(await loadStaffGoogleAds({ workspaceId: workspace.id, userId: user.id, relationshipId }))
    } catch (error) { return errorReply(error) }
}

export async function POST(request: Request, context: Context) {
    try {
        const { workspace, user } = await actor(context)
        const body = await googleAdsBody(request)
        if (typeof body.relationshipId !== "string" || typeof body.customerId !== "string" || (body.action !== "request" && body.action !== "verify")) return googleAdsReply({ error: "Choose a client, customer ID and connection action." }, 400)
        if (body.action === "request" && body.consented !== true) return googleAdsReply({ error: "Confirm you are authorised to send this Google Ads access request." }, 400)
        const connection = await runStaffGoogleAds({ workspaceId: workspace.id, userId: user.id, relationshipId: body.relationshipId }, body.customerId, body.action === "request")
        return googleAdsReply({ connection })
    } catch (error) { return errorReply(error) }
}
