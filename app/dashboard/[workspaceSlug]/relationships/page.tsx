import Link from "next/link"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import {
    RELATIONSHIP_PHASES,
    listRelationshipsForWorkspace,
    phaseLabel,
    relationshipHubHref,
    workspaceHref,
    type RelationshipPhase,
} from "@/lib/relationships"
import { requireWorkspace } from "@/lib/workspaces"
import { formatRelativeTime } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

const phaseTone: Record<RelationshipPhase, string> = {
    found: "bg-sky-400",
    qualified: "bg-emerald-300",
    contacted: "bg-yellow-300",
    sold: "bg-violet-300",
    invoiced: "bg-cyan-300",
    onboarding: "bg-orange-300",
    onboarding_complete: "bg-lime-300",
    fulfilment: "bg-blue-300",
    retention: "bg-fuchsia-300",
    completed_lost: "bg-neutral-500",
}

export default async function RelationshipsPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const relationships = await listRelationshipsForWorkspace(workspace.id)
    const activeRelationships = relationships.filter((relationship) => relationship.status !== "archived")
    const phaseCounts = new Map<RelationshipPhase, number>()
    for (const relationship of activeRelationships) {
        phaseCounts.set(relationship.lifecycle_phase, (phaseCounts.get(relationship.lifecycle_phase) ?? 0) + 1)
    }

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl">
                <header className="flex flex-col justify-between gap-4 border-b border-neutral-800 pb-5 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-3xl font-semibold tracking-tight">
                            Relationships
                        </h1>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                            Person-first records that keep leadgen, sales, onboarding, fulfilment, and future project work attached to one lifetime context.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-sm">
                        <Link href={workspaceHref(workspace.slug, "work")} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:border-neutral-600 hover:text-white">
                            Work Queue
                        </Link>
                        <Link href={workspaceHref(workspace.slug, "clients/new")} className="rounded-lg bg-white px-3 py-2 font-medium text-black">
                            Add client
                        </Link>
                    </div>
                </header>

                <section className="mt-5 grid grid-cols-2 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 sm:grid-cols-5 lg:grid-cols-10">
                    {RELATIONSHIP_PHASES.map((phase) => (
                        <div key={phase.key} className="border-r border-b border-neutral-800 px-3 py-3 last:border-r-0 sm:last:border-r lg:border-b-0">
                            <div className="flex items-center gap-2">
                                <span className={`h-2 w-2 rotate-45 ${phaseTone[phase.key]}`} />
                                <p className="truncate text-xs text-neutral-400">{phase.label}</p>
                            </div>
                            <p className="mt-2 text-xl font-semibold">{phaseCounts.get(phase.key) ?? 0}</p>
                        </div>
                    ))}
                </section>

                <section className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
                    {activeRelationships.length ? (
                        activeRelationships.map((relationship) => (
                            <Link
                                key={relationship.id}
                                href={relationshipHubHref(workspace.slug, relationship.id)}
                                className="grid gap-3 border-b border-neutral-900 px-4 py-4 last:border-0 hover:bg-neutral-900/60 md:grid-cols-[minmax(220px,1.1fr)_minmax(180px,0.8fr)_150px_130px]"
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`h-2 w-2 shrink-0 rotate-45 ${phaseTone[relationship.lifecycle_phase]}`} />
                                        <p className="truncate font-medium text-neutral-100">{relationship.primary_person_name}</p>
                                    </div>
                                    <p className="mt-1 truncate text-sm text-neutral-500">{relationship.primary_email ?? relationship.primary_phone ?? "No direct contact saved"}</p>
                                </div>
                                <p className="min-w-0 truncate text-sm text-neutral-300">{relationship.business_name ?? "No business context yet"}</p>
                                <p className="text-sm text-neutral-400">{phaseLabel(relationship.lifecycle_phase)}</p>
                                <p className="text-sm text-neutral-500 md:text-right">{formatRelativeTime(relationship.updated_at)}</p>
                            </Link>
                        ))
                    ) : (
                        <div className="p-6">
                            <p className="text-lg font-semibold">No relationships yet.</p>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                                Existing clients will appear here automatically once the relationship foundation is available. New qualified leadgen records stay in Lead Gen until a person deliberately creates a Relationship.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </main>
    )
}
