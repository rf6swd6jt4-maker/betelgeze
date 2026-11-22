import { requireCampaigns } from "@/lib/campaigns/server"
import { readFlowImage } from "@/lib/campaigns/flows-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** A text flow's picture, for the editor's preview (docs/text-flows.md). Owners and admins with Campaigns only. */
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace } = await requireCampaigns(workspaceSlug)
    const path = new URL(request.url).searchParams.get("path") ?? ""
    if (!path.startsWith(`${workspace.id}/campaigns/flows/`) || !/^[0-9a-f-]{36}\/campaigns\/flows\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|gif)$/.test(path)) return new Response("Not found", { status: 404 })
    try {
        const file = await readFlowImage(path)
        return new Response(file.bytes as BodyInit, { headers: { "Content-Type": file.type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } })
    } catch { return new Response("Not found", { status: 404 }) }
}
