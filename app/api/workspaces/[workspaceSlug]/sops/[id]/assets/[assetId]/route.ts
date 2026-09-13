import { requireWorkspace } from "@/lib/workspaces"
import { sopAssetResponse } from "@/lib/sops/assets"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string; id: string; assetId: string }> }) {
    const { workspaceSlug, id, assetId } = await context.params
    const { workspace } = await requireWorkspace(workspaceSlug)
    return sopAssetResponse(workspace.id, id, assetId, request)
}
