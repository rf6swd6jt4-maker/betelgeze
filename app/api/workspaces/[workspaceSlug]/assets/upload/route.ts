import { NextRequest } from "next/server"
import { createSignedAssetUpload } from "@/lib/onboarding/uploads"
import { ensurePlatformDirectUploads } from "@/lib/onboarding/r2-cors"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace } = await requireWorkspace(workspaceSlug, "admin")
    const payload = await request.json().catch(() => null) as { name?: unknown; size?: unknown; type?: unknown } | null
    const name = typeof payload?.name === "string" ? payload.name : ""
    const size = typeof payload?.size === "number" ? payload.size : Number(payload?.size ?? 0)
    const type = typeof payload?.type === "string" ? payload.type : "application/octet-stream"

    if (!name || !Number.isFinite(size) || size <= 0) {
        return Response.json({ error: "Invalid asset upload." }, { status: 400 })
    }

    try {
        await ensurePlatformDirectUploads()
        return Response.json(await createSignedAssetUpload(workspace.id, { name, size, type }))
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not prepare upload." }, { status: 400 })
    }
}
