import Link from "next/link"
import { notFound } from "next/navigation"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { Assignee, AttachmentPreview, AttachmentsBlock, RoundPill } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { assetHref, relationshipHubHref } from "@/lib/relationships"
import { getWorkspaceNote, listNoteAssets, listNoteRelationships } from "@/lib/notes"
import { createUploadSignedUrls } from "@/lib/onboarding/uploads"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { NoteEditor } from "./NoteEditor"

export const dynamic = "force-dynamic"

export default async function NoteDetailPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
    const { workspaceSlug, id } = await params
    const { workspace, user, access } = await requireWorkspacePanel(workspaceSlug, "library")
    const notePromise = getWorkspaceNote(workspace.id, id)
    const relationshipsPromise = listNoteRelationships(workspace.id, id)
    const assetsPromise = listNoteAssets(workspace.id, id)
    const creatorPromise = notePromise.then(async (note) => {
        if (!note?.created_by) return null
        const { data } = await supabaseAdmin.from("user_profiles").select("user_id,username,avatar_path").eq("user_id", note.created_by).maybeSingle()
        return data
    })
    const [note, relationships, assets, creator] = await Promise.all([notePromise, relationshipsPromise, assetsPromise, creatorPromise])
    if (!note) notFound()
    const linkCount = relationships.length + assets.length
    const imageStoragePaths = assets.flatMap((link) => link.asset?.storage_path && link.asset.content_type?.startsWith("image/") && link.asset.source_kind !== "message" && link.asset.native_kind !== "sop_extracted_image" ? [link.asset.storage_path] : []).slice(0, 24)
    const previewUrls = await createUploadSignedUrls(imageStoragePaths)
    const creatorAvatarSrc = creator?.avatar_path && creator.username ? profileAvatarUrl(creator.username, creator.avatar_path) : null
    const attachmentPreview = (link: typeof assets[number]) => {
        const asset = link.asset
        if (!asset?.storage_path || !asset.content_type?.startsWith("image/")) return null
        if (asset.native_kind === "sop_extracted_image") return `/api/workspaces/${workspace.slug}/sop-images/${asset.id}?thumbnail=1`
        if (asset.source_kind === "message") return `/api/client-messages/media/${asset.storage_path.split("/").map(encodeURIComponent).join("/")}`
        return previewUrls.get(asset.storage_path) ?? null
    }

    return <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} workspaceAccess={access} currentProduct="client-work" />
        <div className="mx-auto max-w-[92rem]">
            <DetailPageHeader category="Note" reference={shortId(note.id)} title={note.name} facts={[{ label: linkCount === 1 ? "link" : "links", value: linkCount }]} updated={formatRelativeTime(note.updated_at)} />
            <NoteEditor
                workspaceSlug={workspace.slug}
                noteId={note.id}
                name={note.name}
                description={note.description}
                relationships={relationships.map((link) => ({ id: link.relationship_id, label: link.relationship?.business_name ?? link.relationship?.primary_person_name ?? "Relationship" }))}
                assets={assets.map((link) => ({ id: link.asset_id, label: link.asset?.title ?? "Asset", description: link.asset?.asset_kind.replace(/_/g, " ") }))}
            />
            <DetailFields>
                <DetailField label="Created" icon="time">{new Date(note.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</DetailField>
                <DetailField label="Created by" icon="user" className="lg:border-l lg:border-neutral-900 lg:pl-8">{creator ? <Assignee userId={creator.user_id} name={creator.username} avatarSrc={creatorAvatarSrc} /> : <span className="text-neutral-600">System or imported</span>}</DetailField>
                <DetailField label="Description" icon="description" multiline stackOnMobile className="lg:col-span-2"><p className="whitespace-pre-wrap leading-6">{note.description}</p></DetailField>
                <DetailField label="Relationships" icon="relationship" className="lg:col-span-2">
                    <div className="flex flex-wrap gap-1.5">
                        {relationships.length ? relationships.map((link) => <Link key={link.relationship_id} href={relationshipHubHref(workspace.slug, link.relationship_id)}><RoundPill tone="sky">{link.relationship?.business_name ?? link.relationship?.primary_person_name ?? "Relationship"}</RoundPill></Link>) : <span className="text-neutral-600">None</span>}
                    </div>
                </DetailField>
            </DetailFields>
            <AttachmentsBlock empty="No assets are attached to this note yet.">
                {assets.length ? assets.map((link) => <AttachmentPreview key={link.asset_id} href={assetHref(workspace.slug, link.asset_id)} title={link.asset?.title ?? "Asset"} subtitle={link.asset ? `${link.asset.asset_kind.replace(/_/g, " ")} · ${formatRelativeTime(link.asset.updated_at)}` : undefined} previewUrl={attachmentPreview(link)} contentType={link.asset?.content_type} />) : null}
            </AttachmentsBlock>
            <DetailDangerZone>
                <DetailDangerAction title="Archive note" description="Archive will remove this note from the active Library while preserving its linked relationships and assets." control={<DetailDangerButton type="button" disabled>Archive note</DetailDangerButton>} />
                <DetailDangerAction title="Delete note permanently" description="Permanent deletion will be enabled with the shared archive and restoration lifecycle." control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>} />
            </DetailDangerZone>
        </div>
    </main>
}
