import { accessibleAssetIds, accessibleRelationshipIds, accessibleWorkItemIds, requireWorkspaceAccess, workspaceAccessHasCapability } from "@/lib/workspace-access"
import { getAsset } from "@/lib/relationships"
import { createPrivateResourceDownloadUrl } from "@/lib/onboarding/uploads"

export const dynamic = "force-dynamic"
export async function GET(_request: Request, context: { params: Promise<{ workspaceSlug: string; assetId: string }> }) {
    const { workspaceSlug, assetId } = await context.params
    const { workspace, access } = await requireWorkspaceAccess(workspaceSlug)
    const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" }
    if (!workspaceAccessHasCapability(access, "fulfilment.manage") && !workspaceAccessHasCapability(access, "onboarding.manage")) return new Response("File not found", { status: 404, headers })
    const [relationships, workItems] = await Promise.all([accessibleRelationshipIds(access), accessibleWorkItemIds(access)])
    const allowed = await accessibleAssetIds(access, relationships, workItems)
    if (allowed && !allowed.has(assetId)) return new Response("File not found", { status: 404, headers })
    const asset = await getAsset(workspace.id, assetId)
    if (!asset || asset.native_kind !== "client_portal_resource" || !asset.storage_path?.startsWith(`${workspace.id}/client-portal/`)) return new Response("File not found", { status: 404, headers })
    return new Response(null, { status: 303, headers: { ...headers, Location: await createPrivateResourceDownloadUrl(asset.storage_path, asset.title) } })
}
