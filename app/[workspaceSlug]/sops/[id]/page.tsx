import { Suspense } from "react"
import { notFound } from "next/navigation"
import { DetailContentLoading, DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { SopRecordEditor } from "@/components/sops/SopRecordEditor"
import { SopAssetUpload } from "@/components/sops/SopAssetUpload"
import { SopAssets } from "@/components/sops/SopAssets"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { getSopRecord, listSopAssets } from "@/lib/sops/records"
import { sopAiConfiguration } from "@/lib/sops/interpreter"
import { canAddSop, sopCursor } from "@/lib/sops/policy"
import { isSopId } from "@/lib/sops/records-policy"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
export const dynamic = "force-dynamic"
async function Assets({ data, ...props }: { data: ReturnType<typeof listSopAssets>; workspaceSlug: string; sopId: string; paged: boolean; canEdit: boolean; aiReady: boolean }) {
    return <SopAssets {...await data} {...props} />
}
export default async function SopPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string; id: string }>; searchParams: Promise<{ cursor?: string }> }) {
    const { workspaceSlug, id } = await params
    if (!isSopId(id)) notFound()
    const { workspace, user, role, access } = await requireWorkspacePanel(workspaceSlug, "sops")
    const { cursor } = await searchParams
    try { sopCursor(cursor) } catch { notFound() }
    const recordPromise = getSopRecord(workspace.id, id), assetsPromise = listSopAssets(workspace.id, id, cursor)
    // Attach a handler immediately while independent record fields resolve.
    void assetsPromise.catch(() => undefined)
    const sop = await recordPromise
    if (!sop) notFound()
    const admin = canAddSop(role), canEdit = admin && !sop.archived_at
    const editorProps = { workspaceSlug: workspace.slug, workspaceId: workspace.id, userId: user.id, sop }
    return <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} workspaceAccess={access} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl">
            <DetailPageHeader category="SOP" reference={shortId(sop.id)} title={sop.title} updated={formatRelativeTime(sop.updated_at)} />
            <DetailFields><DetailField label="Description" icon="description"><p className="whitespace-pre-wrap break-words">{sop.description || "No description yet."}</p></DetailField><DetailField label="Availability" icon="status" className="lg:border-l lg:pl-8">{sop.archived_at ? "Archived · read only" : "Available to your team"}</DetailField></DetailFields>
            {canEdit ? <SopRecordEditor {...editorProps} mode="fields" /> : null}
            <section className="mt-8"><h2 className="text-base font-medium text-white">Assets</h2><p className="mt-1 text-sm text-neutral-500">The procedure and the material that explains how to carry it out.</p>
                {canEdit ? <SopAssetUpload workspaceSlug={workspace.slug} workspaceId={workspace.id} userId={user.id} sopId={sop.id} /> : null}
                <Suspense fallback={<DetailContentLoading label="Loading assets" />}><Assets data={assetsPromise} workspaceSlug={workspace.slug} sopId={sop.id} paged={Boolean(cursor)} canEdit={canEdit} aiReady={sopAiConfiguration().ready} /></Suspense>
            </section>
            {admin ? <SopRecordEditor {...editorProps} mode="danger" /> : null}
        </div>
    </main>
}
