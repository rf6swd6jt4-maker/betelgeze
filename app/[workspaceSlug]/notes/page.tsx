import Link from "next/link"
import { LibraryTabs } from "@/components/library/LibraryTabs"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { listWorkspaceNotes, noteHref } from "@/lib/notes"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { workspaceHref } from "@/lib/relationships"

export const dynamic = "force-dynamic"

export default async function NotesPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const { workspace, user, access } = await requireWorkspacePanel(workspaceSlug, "library")
    const notes = await listWorkspaceNotes(workspace.id)
    const linkedRelationships = notes.reduce((total, note) => total + note.note_relationships.length, 0)
    const linkedAssets = notes.reduce((total, note) => total + note.note_assets.length, 0)

    return <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} workspaceAccess={access} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl">
            <PanelTabHeader
                title="Notes"
                description="Call notes and durable workspace context, ordered by their most recent update."
                actions={<Link href={workspaceHref(workspace.slug, "notes?create=note")} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3">New note</Link>}
                tabs={<LibraryTabs workspaceSlug={workspace.slug} active="notes" />}
            />
            <QuickStats ariaLabel="Note statistics" items={[
                { label: "Total", value: notes.length },
                { label: "Relationship links", value: linkedRelationships },
                { label: "Asset links", value: linkedAssets },
            ]} />
            {notes.length ? <List ariaLabel="Notes">
                {notes.map((note) => {
                    const href = noteHref(workspace.slug, note.id)
                    const linkCount = note.note_relationships.length + note.note_assets.length
                    return <ListItem key={note.id} detailPreview={{ category: "Note", reference: shortId(note.id), title: note.name, updated: formatRelativeTime(note.updated_at) }}>
                        <ListPrimaryRow>
                            <ListTitle href={href} className="flex-1">{note.name}</ListTitle>
                            <span className="shrink-0 text-xs text-neutral-500">{linkCount} {linkCount === 1 ? "link" : "links"}</span>
                        </ListPrimaryRow>
                        <ListSecondaryRow>
                            <span className="min-w-0 flex-1 truncate text-neutral-400">{note.description}</span>
                            <ListTrailing>
                                <span className="font-mono text-neutral-500">{shortId(note.id)}</span>
                                <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(note.updated_at)}</span>
                            </ListTrailing>
                        </ListSecondaryRow>
                    </ListItem>
                })}
            </List> : <section className="mt-5 rounded-2xl border border-neutral-800 bg-black p-6">
                <p className="text-lg font-semibold">No notes yet.</p>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Add a call note or other reusable context from the quick actions.</p>
            </section>}
        </div>
    </main>
}
