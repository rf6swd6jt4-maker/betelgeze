import Link from "next/link"
import { notFound } from "next/navigation"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import {
    getRelationship,
    onboardingDetailHref,
    phaseLabel,
    workDetailHref,
} from "@/lib/relationships"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; relationshipId: string }>
}

export default async function RelationshipDetailPlaceholder({ params }: PageProps) {
    const { workspaceSlug, relationshipId } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const relationship = await getRelationship(workspace.id, relationshipId)
    if (!relationship) notFound()

    const isOnboarding = ["onboarding", "onboarding_complete"].includes(relationship.lifecycle_phase)
    const isFulfilment = relationship.lifecycle_phase === "fulfilment"

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <header className="border-b border-neutral-800 pb-6">
                            <p className="text-sm text-neutral-500">Relationship detail</p>
                            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{relationship.primary_person_name}</h1>
                            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
                                This page will become the combined relationship summary with a Gantt chart at the top. Gantt items will deep-link into onboarding, project management, communications, invoices, assets, and future global work-item details.
                            </p>
                        </header>

                        <section className="mt-6 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                                <p className="text-sm text-neutral-500">Company</p>
                                <p className="mt-2 font-medium">{relationship.business_name ?? "No company saved"}</p>
                            </div>
                            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                                <p className="text-sm text-neutral-500">Lifecycle</p>
                                <p className="mt-2 font-medium">{phaseLabel(relationship.lifecycle_phase)}</p>
                            </div>
                            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                                <p className="text-sm text-neutral-500">Updated</p>
                                <p className="mt-2 font-medium">{formatRelativeTime(relationship.updated_at)}</p>
                            </div>
                        </section>

                        <section className="mt-6 rounded-2xl border border-neutral-800 bg-black p-5">
                            <h2 className="text-lg font-semibold">Future relationship Gantt</h2>
                            <p className="mt-2 text-sm leading-6 text-neutral-400">
                                Placeholder for a timeline of relationship work, onboarding steps, fulfilment tasks, communications, invoices, and retained assets. This push only restores the correct page boundary.
                            </p>
                            <div className="mt-4 flex flex-wrap gap-2 text-sm">
                                {isOnboarding && (
                                    <Link href={onboardingDetailHref(workspace.slug, relationship.id)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:text-white">
                                        Open onboarding detail
                                    </Link>
                                )}
                                {isFulfilment && (
                                    <Link href={workDetailHref(workspace.slug, relationship.id)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:text-white">
                                        Open project detail
                                    </Link>
                                )}
                            </div>
                        </section>

                        <section className="mt-6 rounded-2xl border border-red-500/20 bg-red-950/10 p-5">
                            <h2 className="text-lg font-semibold text-red-100">Danger zone placeholder</h2>
                            <p className="mt-2 text-sm leading-6 text-red-100/70">
                                Archive/delete relationship actions will live here in a later focused detail-page pass.
                            </p>
                        </section>
                    </div>

                    <ClientContextPanel workspaceSlug={workspace.slug} relationship={relationship} />
                </div>
            </div>
        </main>
    )
}
