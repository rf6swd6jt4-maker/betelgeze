import { NextResponse } from "next/server"
import { unstable_rethrow } from "next/navigation"
import { assetDownloadHref } from "@/lib/assets/download"
import { assetPreviewUrl } from "@/lib/assets/preview"
import { decodeAttachmentCursor, encodeAttachmentCursor } from "@/lib/attachment-pages"
import { listWorkspaceAssetsAfter } from "@/lib/relationships"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" }

/** The Library's Load more: one page of assets older than the cursor, in the shape of the first page's cards. */
export async function GET(request: Request, { params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    let position
    try { position = decodeAttachmentCursor(new URL(request.url).searchParams.get("cursor"))?.asset } catch { position = null }
    if (!position) return NextResponse.json({ error: "Invalid asset page." }, { status: 400, headers: privateHeaders })
    try {
        const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "library")
        if (request.headers.get("x-workspace-user") !== user.id) return NextResponse.json({ error: "Your session changed. Reload the workspace." }, { status: 409, headers: privateHeaders })
        // Read as the current session, so record policy decides what this person may see.
        const page = await listWorkspaceAssetsAfter(workspace.id, position, await createSupabaseServerClient())
        const entries = await Promise.all(page.items.map(async asset => ({
            asset: { id: asset.id, title: asset.title, content_type: asset.content_type, file_size: asset.file_size, updated_at: asset.updated_at },
            downloadHref: assetDownloadHref(workspace.slug, asset),
            previewUrl: asset.content_type?.startsWith("image/") && asset.storage_path ? await assetPreviewUrl(workspace.id, workspace.slug, asset, true) : null,
        })))
        return NextResponse.json({ entries, nextCursor: encodeAttachmentCursor({ asset: page.next, note: null }) }, { headers: privateHeaders })
    } catch (error) {
        unstable_rethrow(error)
        return NextResponse.json({ error: "Could not load assets. Please retry." }, { status: 500, headers: privateHeaders })
    }
}
