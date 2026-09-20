import Link from "next/link"
import { notFound } from "next/navigation"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, DetailField, DetailPageHeader } from "@/components/detail"
import { Assignee, RoundPill } from "@/components/ui"
import { RecordAttachments } from "@/components/detail/RecordAttachments"
import { NoteFieldsEditor } from "./NoteFieldsEditor"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { relationshipHubHref } from "@/lib/relationships"
import { getWorkspaceNote, listNoteAssets, listNoteRelationships } from "@/lib/notes"
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
    const creatorAvatarSrc = creator?.avatar_path && creator.username ? profileAvatarUrl(creator.username, creator.avatar_path) : null
    const relationshipLinks = <DetailField label="Relationships" icon="relationship"><div className="flex flex-wrap items-center gap-2">{relationships.map(link => <Link key={link.relationship_id} href={relationshipHubHref(workspace.slug, link.relationship_id)}><RoundPill tone="sky">{link.relationship?.business_name ?? link.relationship?.primary_person_name ?? "Relationship"}</RoundPill></Link>)}<NoteEditor workspaceSlug={workspace.slug} noteId={note.id} relationships={relationships.map(link => ({ id: link.relationship_id, label: link.relationship?.business_name ?? link.relationship?.primary_person_name ?? "Relationship" }))} /></div></DetailField>
    const creatorField = creator ? <Assignee userId={creator.user_id} name={creator.username} avatarSrc={creatorAvatarSrc} /> : <span className="text-neutral-600">System or imported</span>
    return <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} workspaceAccess={access} currentProduct="client-work" />
        <div className="mx-auto max-w-[92rem]">
            <DetailPageHeader category="Note" reference={shortId(note.id)} title={note.name} facts={[{ label: linkCount === 1 ? "link" : "links", value: linkCount }]} updated={formatRelativeTime(note.updated_at)} />
            <NoteFieldsEditor slug={workspace.slug} noteId={note.id} name={note.name} description={note.description} createdAt={note.created_at} creator={creatorField} links={relationshipLinks} />
            <RecordAttachments workspaceSlug={workspace.slug} userId={user.id} owner="note" ownerId={note.id} canEdit={access.role === "owner" || access.role === "admin"} />
            <DetailDangerZone>
                <DetailDangerAction title="Archive note" description="Archive will remove this note from the active Library while preserving its linked relationships and assets." control={<DetailDangerButton type="button" disabled>Archive note</DetailDangerButton>} />
                <DetailDangerAction title="Delete note permanently" description="Permanent deletion will be enabled with the shared archive and restoration lifecycle." control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>} />
            </DetailDangerZone>
        </div>
    </main>
}
