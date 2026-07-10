import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import {
    RELATIONSHIP_PHASES,
    countOpenWorkItemsByRelationship,
    relationshipIndustryLabel,
    relationshipLocationLabel,
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
    lead: "bg-sky-400",
    nurturing: "bg-fuchsia-300",
    potential_client: "bg-yellow-300",
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
    const [relationships, openWorkCounts] = await Promise.all([
        listRelationshipsForWorkspace(workspace.id),
        countOpenWorkItemsByRelationship(workspace.id),
    ])
    const activeRelationships = relationships.filter((relationship) => relationship.status !== "archived")
    const phaseCounts = new Map<RelationshipPhase, number>()
    for (const relationship of activeRelationships) {
        phaseCounts.set(relationship.lifecycle_phase, (phaseCounts.get(relationship.lifecycle_phase) ?? 0) + 1)
    }

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Relationships
                        </h1>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                            The canonical CRM surface for leads, sales, onboarding, fulfilment, assets, and future project work.
                        </p>
                    </div>
                    <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
                        <Link href={workspaceHref(workspace.slug, "relationships/new")} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3">
                            Start new relationship
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
                        activeRelationships.map((relationship) => {
                            const industry = relationshipIndustryLabel(relationship.industry_value)
                            const location = relationshipLocationLabel(relationship)
                            const openWorkCount = openWorkCounts.get(relationship.id) ?? 0
                            return (
                                <Link
                                    key={relationship.id}
                                    href={relationshipHubHref(workspace.slug, relationship.id)}
                                    className="grid gap-3 border-b border-neutral-900 px-4 py-4 last:border-0 hover:bg-neutral-900/60 lg:grid-cols-[minmax(220px,1.1fr)_minmax(190px,0.85fr)_minmax(160px,0.7fr)_145px_115px_130px]"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={`h-2 w-2 shrink-0 rotate-45 ${phaseTone[relationship.lifecycle_phase]}`} />
                                            <p className="truncate font-medium text-neutral-100">{relationship.primary_person_name}</p>
                                        </div>
                                        <p className="mt-1 truncate text-sm text-neutral-500">{relationship.primary_phone ?? relationship.primary_email ?? "No direct contact saved"}</p>
                                    </div>
                                    <div className="min-w-0">
                                        <p className="truncate text-sm text-neutral-300">{relationship.business_name ?? "No company context yet"}</p>
                                        <p className="mt-1 truncate text-xs text-neutral-600">{relationship.primary_contact_role ?? relationship.source_label ?? relationship.source_type}</p>
                                    </div>
                                    <div className="min-w-0 text-sm text-neutral-400">
                                        <p className="truncate capitalize">{industry ?? "Industry unset"}</p>
                                        <p className="mt-1 truncate text-xs text-neutral-600 capitalize">{location ?? "Location unset"}</p>
                                    </div>
                                    <p className="text-sm text-neutral-400">{phaseLabel(relationship.lifecycle_phase)}</p>
                                    <p className="text-sm text-neutral-500">{openWorkCount ? `${openWorkCount} open` : "No open work"}</p>
                                    <p className="text-sm text-neutral-500 lg:text-right">{formatRelativeTime(relationship.updated_at)}</p>
                                </Link>
                            )
                        })
                    ) : (
                        <div className="p-6">
                            <p className="text-lg font-semibold">No relationships yet.</p>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                                Promote a qualified lead or start a relationship manually. From here it can move into nurturing, sales, onboarding, fulfilment, and retention without changing record type.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </main>
    )
}
