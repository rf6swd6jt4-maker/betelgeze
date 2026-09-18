import Link from "next/link"
import { notFound } from "next/navigation"
import { DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { RoundPill } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { assetHref, relationshipHubHref } from "@/lib/relationships"
import { getWorkspaceNote, listNoteAssets, listNoteRelationships } from "@/lib/notes"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

export default async function NoteDetailPage({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
    const { workspaceSlug, id } = await params
    const { workspace, user, access } = await requireWorkspacePanel(workspaceSlug, "library")
    const [note, relationships, assets] = await Promise.all([
        getWorkspaceNote(workspace.id, id),
        listNoteRelationships(workspace.id, id),
        listNoteAssets(workspace.id, id),
    ])
    if (!note) notFound()
    const linkCount = relationships.length + assets.length

    return <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} workspaceAccess={access} currentProduct="client-work" />
        <div className="mx-auto max-w-[92rem]">
            <DetailPageHeader category="Note" reference={shortId(note.id)} title={note.name} facts={[{ label: linkCount === 1 ? "link" : "links", value: linkCount }]} updated={formatRelativeTime(note.updated_at)} />
            <DetailFields>
                <DetailField label="Relationships" icon="relationship" className="lg:col-span-2">
                    <div className="flex flex-wrap gap-1.5">
                        {relationships.length ? relationships.map((link) => <Link key={link.relationship_id} href={relationshipHubHref(workspace.slug, link.relationship_id)}><RoundPill tone="sky">{link.relationship?.business_name ?? link.relationship?.primary_person_name ?? "Relationship"}</RoundPill></Link>) : <span className="text-neutral-600">None</span>}
                    </div>
                </DetailField>
                <DetailField label="Assets" icon="file" className="lg:col-span-2">
                    <div className="flex flex-wrap gap-1.5">
                        {assets.length ? assets.map((link) => <Link key={link.asset_id} href={assetHref(workspace.slug, link.asset_id)}><RoundPill tone="neutral">{link.asset?.title ?? "Asset"}</RoundPill></Link>) : <span className="text-neutral-600">None</span>}
                    </div>
                </DetailField>
                <DetailField label="Description" icon="description" className="lg:col-span-2"><p className="whitespace-pre-wrap leading-6">{note.description}</p></DetailField>
                <DetailField label="Created" icon="time">{new Date(note.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</DetailField>
                <DetailField label="Reference" icon="identity" className="lg:border-l lg:border-neutral-900 lg:pl-8"><span className="font-mono">{shortId(note.id)}</span></DetailField>
            </DetailFields>
        </div>
    </main>
}
