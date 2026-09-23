import { NextRequest } from "next/server"
import { prepareAssetUpload } from "@/lib/assets/uploads"
import { ensurePlatformDirectUploads } from "@/lib/onboarding/r2-cors"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"
export async function POST(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const headers = { "Cache-Control": "private, no-store" }
    if (request.headers.get("origin") !== request.nextUrl.origin || request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your session changed. Reload the uploader." }, { status: 403, headers })
    const payload = await request.json().catch(() => null) as { name?: unknown; size?: unknown; type?: unknown; requestId?: unknown } | null
    try {
        const name = typeof payload?.name === "string" ? payload.name : ""
        const size = typeof payload?.size === "number" ? payload.size : 0
        const type = typeof payload?.type === "string" ? payload.type : "application/octet-stream"
        const id = typeof payload?.requestId === "string" ? payload.requestId : ""
        // Existing CORS owner remains unchanged apart from the additional required header.
        await ensurePlatformDirectUploads()
        return Response.json(await prepareAssetUpload(workspace.id, user.id, id, { name, size, type }), { headers })
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not prepare upload." }, { status: 400, headers })
    }
}
