import { requireWorkspaceAccess, workspaceAccessHasCapability } from "@/lib/workspace-access"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { downloadableAsset, MAX_ASSET_ARCHIVE_BYTES, parseAssetDownloadIds, type DownloadableAsset } from "@/lib/assets/download"
import { assetArchiveResponse, assetDownloadHeaders, assetDownloadResponse } from "@/lib/assets/download-response"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, access } = await requireWorkspaceAccess(workspaceSlug)
    if (!workspaceAccessHasCapability(access, "fulfilment.manage") && !workspaceAccessHasCapability(access, "onboarding.manage")) return new Response("Files not found", { status: 404, headers: assetDownloadHeaders })
    const ids = parseAssetDownloadIds(new URL(request.url).searchParams.get("ids"))
    if (!ids) return new Response("Select between 1 and 24 assets.", { status: 400, headers: assetDownloadHeaders })
    try {
        const reader = await createSupabaseServerClient()
        // One bounded actor-bound read; the whole selection must remain readable.
        const result = await reader.from("assets").select("id,workspace_id,storage_path,source_kind,native_kind,title,content_type,file_size").eq("workspace_id", workspace.id).in("id", ids).limit(ids.length)
        if (result.error) return new Response("Could not verify asset access. Please retry.", { status: 503, headers: assetDownloadHeaders })
        const assets = result.data as DownloadableAsset[]
        const byId = new Map(assets.map(asset => [asset.id, asset]))
        if (byId.size !== ids.length || assets.some(asset => asset.workspace_id !== workspace.id || !downloadableAsset(asset))) return new Response("An asset is unavailable. Refresh the library and retry.", { status: 404, headers: assetDownloadHeaders })
        const ordered = ids.map(id => byId.get(id)!)
        if (ordered.length === 1) return await assetDownloadResponse(workspaceSlug, ordered[0], request)
        if (assets.reduce((total, asset) => total + Math.max(0, asset.file_size ?? 0), 0) > MAX_ASSET_ARCHIVE_BYTES) return new Response("Download at most 500MB at once, or download large assets individually.", { status: 413, headers: assetDownloadHeaders })
        return await assetArchiveResponse(workspaceSlug, ordered, request)
    } catch {
        return new Response("Could not download these assets. Please retry.", { status: 503, headers: assetDownloadHeaders })
    }
}
