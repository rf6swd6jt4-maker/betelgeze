import Link from "next/link"
import { notFound } from "next/navigation"
import { RelationshipStage } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import {
    getRelationship,
    onboardingDetailHref,
    workDetailHref,
} from "@/lib/relationships"
import { effectiveGanttRanges, getRelationshipGanttPlan } from "@/lib/relationship-gantt"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import { RelationshipGantt } from "./RelationshipGantt"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; relationshipId: string }>
}

export default async function RelationshipDetailPage({ params }: PageProps) {
    const { workspaceSlug, relationshipId } = await params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    const relationship = await getRelationship(workspace.id, relationshipId)
    if (!relationship) notFound()
    const plan = await getRelationshipGanttPlan(workspace.slug, relationship)
    const planRanges = effectiveGanttRanges(plan.items)

    const isOnboarding = ["onboarding", "onboarding_complete"].includes(relationship.lifecycle_phase)
    const isFulfilment = relationship.lifecycle_phase === "fulfilment"

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <header className="flex flex-col gap-3 border-b border-neutral-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
                            <div className="min-w-0">
                                <p className="font-mono text-xs text-neutral-600">Relationship {shortId(relationship.id)}</p>
                                <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{relationship.primary_person_name}</h1>
                                <p className="mt-1 truncate text-sm text-neutral-500">{relationship.business_name ?? "No company saved"}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-500">
                                <RelationshipStage phase={relationship.lifecycle_phase} />
                                <span><strong className="mr-1 text-neutral-200">{plan.items.filter((item) => !["done", "canceled"].includes(item.status)).length}</strong> open</span>
                                <span><strong className="mr-1 text-neutral-200">{plan.items.filter((item) => !planRanges.has(item.id)).length}</strong> unscheduled</span>
                                <span>Updated {formatRelativeTime(relationship.updated_at)}</span>
                            </div>
                        </header>

                        <RelationshipGantt workspaceSlug={workspace.slug} relationshipId={relationship.id} plan={plan} canEdit={role === "owner" || role === "admin"} />

                        <section className="mt-5 flex flex-wrap gap-2 border-t border-neutral-900 pt-5 text-sm">
                            {isOnboarding && <Link href={onboardingDetailHref(workspace.slug, relationship.id)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:text-white">Open onboarding detail</Link>}
                            {isFulfilment && <Link href={workDetailHref(workspace.slug, relationship.id)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:text-white">Open project detail</Link>}
                        </section>

                    </div>

                    <ClientContextPanel workspaceSlug={workspace.slug} relationship={relationship} />
                </div>
            </div>
        </main>
    )
}
