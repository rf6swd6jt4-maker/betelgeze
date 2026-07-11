import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { MobileCardActionSurface } from "@/components/list/MobileCardActionSurface"
import { SquarePill, type PillTone } from "@/components/ui"
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
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

const phaseTone: Record<RelationshipPhase, PillTone> = {
    lead: "sky",
    nurturing: "violet",
    potential_client: "amber",
    invoiced: "sky",
    onboarding: "amber",
    onboarding_complete: "emerald",
    fulfilment: "sky",
    retention: "violet",
    completed_lost: "neutral",
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
                        <Link href={workspaceHref(workspace.slug, "relationships?create=relationship")} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3">
                            Start new relationship
                        </Link>
                    </div>
                </header>

                <section className="mt-5 grid grid-cols-2 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 sm:grid-cols-5 lg:grid-cols-10">
                    {RELATIONSHIP_PHASES.map((phase) => (
                        <div key={phase.key} className="border-r border-b border-neutral-800 px-3 py-3 last:border-r-0 sm:last:border-r lg:border-b-0">
                            <p className="truncate text-xs text-neutral-500">{phase.label}</p>
                            <p className="mt-2 text-xl font-semibold">{phaseCounts.get(phase.key) ?? 0}</p>
                        </div>
                    ))}
                </section>

                <section className="mt-5 space-y-3 2xl:space-y-0 2xl:overflow-hidden 2xl:rounded-2xl 2xl:border 2xl:border-neutral-800 2xl:bg-black">
                    {activeRelationships.length ? (
                        activeRelationships.map((relationship) => {
                            const industry = relationshipIndustryLabel(relationship.industry_value)
                            const location = relationshipLocationLabel(relationship)
                            const openWorkCount = openWorkCounts.get(relationship.id) ?? 0
                            const relationshipHref = relationshipHubHref(workspace.slug, relationship.id)
                            const contactPath = relationship.primary_phone ?? relationship.primary_email ?? "No direct contact saved"
                            const relationshipActions = [
                                { label: "Open relationship", href: relationshipHref },
                                relationship.primary_phone ? { label: "Copy phone", copyText: relationship.primary_phone } : {},
                                relationship.primary_email ? { label: "Copy email", copyText: relationship.primary_email } : {},
                            ]
                            return (
                                <div key={relationship.id} className="2xl:border-b 2xl:border-neutral-900 2xl:last:border-0">
                                    <MobileCardActionSurface actions={relationshipActions} label={`Open actions for ${relationship.primary_person_name}`} className="rounded-2xl border border-neutral-800 bg-black 2xl:hidden">
                                        <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-neutral-900 bg-neutral-900/35 px-3.5 py-2.5">
                                            <Link href={relationshipHref} className="min-w-0 flex-1 truncate text-base font-medium text-neutral-100 underline decoration-neutral-600 underline-offset-4 hover:text-white">
                                                {relationship.primary_person_name}
                                            </Link>
                                            <SquarePill tone={phaseTone[relationship.lifecycle_phase]} className="shrink-0">
                                                {phaseLabel(relationship.lifecycle_phase)}
                                            </SquarePill>
                                        </div>
                                        <div className="flex items-center gap-3 px-3.5 py-2.5">
                                            <p className="min-w-0 flex-1 truncate text-sm text-neutral-200">{relationship.business_name ?? contactPath}</p>
                                            <p className="truncate text-sm text-neutral-500">{openWorkCount ? `${openWorkCount} open` : "No open work"}</p>
                                            <p className="font-mono text-sm text-neutral-500">{shortId(relationship.id)}</p>
                                            <p className="whitespace-nowrap text-sm text-neutral-500">{formatRelativeTime(relationship.updated_at)}</p>
                                        </div>
                                    </MobileCardActionSurface>

                                    <div className="hidden min-h-14 gap-3 px-4 py-2.5 2xl:grid 2xl:grid-cols-[minmax(200px,1fr)_minmax(180px,0.9fr)_150px_minmax(150px,0.75fr)_120px_100px_120px_32px] 2xl:items-center">
                                        <div className="min-w-0">
                                            <Link href={relationshipHref} className="truncate text-base font-medium text-neutral-100 hover:text-white hover:underline hover:decoration-neutral-600 hover:underline-offset-4">
                                                {relationship.primary_person_name}
                                            </Link>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate text-sm text-neutral-200">{relationship.business_name ?? "No company context yet"}</p>
                                            <p className="truncate text-xs text-neutral-600">{relationship.primary_contact_role ?? relationship.source_label ?? relationship.source_type}</p>
                                        </div>
                                        <SquarePill tone={phaseTone[relationship.lifecycle_phase]} className="w-fit">
                                            {phaseLabel(relationship.lifecycle_phase)}
                                        </SquarePill>
                                        <div className="min-w-0">
                                            <p className="truncate text-sm text-neutral-300">{contactPath}</p>
                                            <p className="truncate text-xs capitalize text-neutral-600">{location ?? "Location unset"}</p>
                                        </div>
                                        <p className="truncate text-sm capitalize text-neutral-400">{industry ?? "Industry unset"}</p>
                                        <p className="text-sm text-neutral-500">{openWorkCount ? `${openWorkCount} open` : "No open work"}</p>
                                        <div className="text-right">
                                            <p className="whitespace-nowrap text-sm text-neutral-500">{formatRelativeTime(relationship.updated_at)}</p>
                                            <p className="font-mono text-xs text-neutral-600">{shortId(relationship.id)}</p>
                                        </div>
                                        <ListActionMenu actions={relationshipActions} />
                                    </div>
                                </div>
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
