import { requireWorkspaceAccess, workspaceAccessHasCapability } from "@/lib/workspace-access"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getAsset } from "@/lib/relationships"
import { createPrivateResourceDownloadUrl } from "@/lib/onboarding/uploads"

export const dynamic = "force-dynamic"
export async function GET(_request: Request, context: { params: Promise<{ workspaceSlug: string; assetId: string }> }) {
    const { workspaceSlug, assetId } = await context.params
    const { workspace, access } = await requireWorkspaceAccess(workspaceSlug)
    const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" }
    if (!workspaceAccessHasCapability(access, "fulfilment.manage") && !workspaceAccessHasCapability(access, "onboarding.manage")) return new Response("File not found", { status: 404, headers })
    const asset = await getAsset(workspace.id, assetId, await createSupabaseServerClient())
    if (!asset || asset.native_kind !== "client_portal_resource" || !asset.storage_path?.startsWith(`${workspace.id}/client-portal/`)) return new Response("File not found", { status: 404, headers })
    return new Response(null, { status: 303, headers: { ...headers, Location: await createPrivateResourceDownloadUrl(asset.storage_path, asset.title) } })
}
