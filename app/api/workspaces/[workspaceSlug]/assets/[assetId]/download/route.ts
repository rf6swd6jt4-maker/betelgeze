import { requireWorkspaceAccess, workspaceAccessHasCapability } from "@/lib/workspace-access"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getAsset } from "@/lib/relationships"
import { assetDownloadHeaders, assetDownloadResponse } from "@/lib/assets/download-response"

export const dynamic = "force-dynamic"
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string; assetId: string }> }) {
    const { workspaceSlug, assetId } = await context.params
    const { workspace, access } = await requireWorkspaceAccess(workspaceSlug)
    if (!workspaceAccessHasCapability(access, "fulfilment.manage") && !workspaceAccessHasCapability(access, "onboarding.manage")) return new Response("File not found", { status: 404, headers: assetDownloadHeaders })
    try {
        const asset = await getAsset(workspace.id, assetId, await createSupabaseServerClient())
        if (!asset || asset.workspace_id !== workspace.id) return new Response("File not found", { status: 404, headers: assetDownloadHeaders })
        return await assetDownloadResponse(workspaceSlug, asset, request)
    } catch {
        return new Response("Could not download this asset. Please retry.", { status: 503, headers: assetDownloadHeaders })
    }
}
