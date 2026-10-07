import { AssetLibrary } from "@/components/library/AssetLibrary"
import { assetDownloadHref } from "@/lib/assets/download"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { listWorkspaceAssets, type RelationshipAsset } from "@/lib/relationships"
import { assetPreviewUrl } from "@/lib/assets/preview"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

function isImage(asset: RelationshipAsset) {
    return Boolean(asset.content_type?.startsWith("image/"))
}

export default async function AssetsPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "library")
    const assets = await listWorkspaceAssets(workspace.id, await createSupabaseServerClient())
    const imageAssets = assets.filter(isImage)
    const documentCount = assets.filter((asset) => asset.asset_kind === "document" || asset.content_type === "application/pdf").length
    const uploadCount = assets.filter((asset) => asset.source_kind === "upload").length
    const previewEntries = await Promise.all(assets.slice(0, 24).map(async (asset) => ({
        asset: { id: asset.id, title: asset.title, content_type: asset.content_type, file_size: asset.file_size, updated_at: asset.updated_at },
        downloadHref: assetDownloadHref(workspace.slug, asset),
        previewUrl: isImage(asset) && asset.storage_path
            ? await assetPreviewUrl(workspace.id, workspace.slug, asset, true)
            : null,
    })))

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl">
                <AssetLibrary key={workspace.slug} workspaceSlug={workspace.slug} previewEntries={previewEntries} counts={{ total: assets.length, images: imageAssets.length, documents: documentCount, uploads: uploadCount }} />
            </div>
        </main>
    )
}
