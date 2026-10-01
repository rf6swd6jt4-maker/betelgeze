import "server-only"

import { createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"

export type AssetPreviewSource = {
    id: string
    workspace_id: string
    storage_path: string | null
    external_url?: string | null
    source_kind: string
    native_kind: string | null
}

/** Call only after record authorization; never publish private files on the branding CDN. */
export async function assetPreviewUrl(workspaceId: string, workspaceSlug: string, asset: AssetPreviewSource, thumbnail = false): Promise<string | null> {
    if (asset.workspace_id !== workspaceId) return null
    if (asset.native_kind === "sop_extracted_image") return `/api/workspaces/${encodeURIComponent(workspaceSlug)}/sop-images/${asset.id}${thumbnail ? "?thumbnail=1" : ""}`
    if (!asset.storage_path) {
        if (!asset.external_url) return null
        try { return ["https:", "http:"].includes(new URL(asset.external_url).protocol) ? asset.external_url : null }
        catch { return null }
    }
    // An asset record is not authority to sign a foreign workspace's object.
    if (!asset.storage_path.startsWith(`${workspaceId}/`) || asset.storage_path.split("/").some(part => !part || part === "." || part === "..")) return null
    if (asset.source_kind === "message") return `/api/client-messages/media/${asset.storage_path.split("/").map(encodeURIComponent).join("/")}`
    return createPrivateUploadSignedUrl(asset.storage_path)
}
