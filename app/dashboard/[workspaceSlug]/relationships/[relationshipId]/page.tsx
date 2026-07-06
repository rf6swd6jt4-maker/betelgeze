import Link from "next/link"
import { notFound } from "next/navigation"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import {
    RELATIONSHIP_PHASES,
    getRelationship,
    listRelationshipTimelineItems,
    nativeItemHref,
    phaseLabel,
    relationshipNativeLocation,
    workspaceHref,
    type RelationshipPhase,
    type RelationshipWorkItem,
} from "@/lib/relationships"
import { requireWorkspace } from "@/lib/workspaces"
import { formatRelativeTime } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; relationshipId: string }>
    searchParams: Promise<{ view?: string }>
}

const phaseTone: Record<RelationshipPhase, { bar: string; text: string }> = {
    found: { bar: "bg-sky-400", text: "text-sky-200" },
    qualified: { bar: "bg-emerald-300", text: "text-emerald-200" },
    contacted: { bar: "bg-yellow-300", text: "text-yellow-200" },
    sold: { bar: "bg-violet-300", text: "text-violet-200" },
    invoiced: { bar: "bg-cyan-300", text: "text-cyan-200" },
    onboarding: { bar: "bg-orange-300", text: "text-orange-200" },
    onboarding_complete: { bar: "bg-lime-300", text: "text-lime-200" },
    fulfilment: { bar: "bg-blue-300", text: "text-blue-200" },
    retention: { bar: "bg-fuchsia-300", text: "text-fuchsia-200" },
    completed_lost: { bar: "bg-neutral-500", text: "text-neutral-300" },
}

function statusText(status: RelationshipWorkItem["status"]) {
    if (status === "done") return "Done"
    if (status === "doing") return "Doing"
    if (status === "waiting") return "Waiting"
    if (status === "blocked") return "Blocked"
    if (status === "canceled") return "Canceled"
    return "Todo"
}

function itemDate(item: RelationshipWorkItem) {
    return item.planned_start_date ?? item.actual_start_at ?? item.created_at
}

export default async function RelationshipHubPage({ params, searchParams }: PageProps) {
    const { workspaceSlug, relationshipId } = await params
    const { view } = await searchParams
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const relationship = await getRelationship(workspace.id, relationshipId)
    if (!relationship) notFound()
    const allItems = await listRelationshipTimelineItems(workspace.slug, relationship)
    const showAll = view === "all"
    const visibleItems = showAll ? allItems : allItems.filter((item) => item.is_key_task)
    const itemsByPhase = new Map<RelationshipPhase, RelationshipWorkItem[]>()
    for (const item of visibleItems) {
        const existing = itemsByPhase.get(item.lifecycle_phase) ?? []
        existing.push(item)
        itemsByPhase.set(item.lifecycle_phase, existing)
    }
    const currentNativeHref = relationshipNativeLocation(workspace.slug, relationship)

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <div className="flex flex-col justify-between gap-4 border-b border-neutral-800 pb-5 lg:flex-row lg:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            {relationship.primary_person_name}
                        </h1>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                            {relationship.business_name ?? "No business context saved"}{relationship.primary_email ? ` - ${relationship.primary_email}` : ""}{relationship.primary_phone ? ` - ${relationship.primary_phone}` : ""}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-sm">
                        <Link href={showAll ? relationshipHubHref(workspace.slug, relationship.id) : `${relationshipHubHref(workspace.slug, relationship.id)}?view=all`} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:border-neutral-600 hover:text-white">
                            {showAll ? "Show key tasks" : "Expand all tasks"}
                        </Link>
                        <Link href={currentNativeHref} className="rounded-lg bg-white px-3 py-2 font-medium text-black">
                            Open native record
                        </Link>
                    </div>
                </div>

                <section className="mt-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-semibold">Lifetime Gantt</h2>
                            <p className="mt-1 text-sm text-neutral-500">A hybrid timeline: real dates where Betelgeze has them, ordered lifecycle phases where it does not.</p>
                        </div>
                        <span className="hidden rounded-full bg-neutral-900 px-3 py-1 text-xs text-neutral-400 sm:inline-flex">
                            {visibleItems.length} visible work items
                        </span>
                    </div>
                    <div className="overflow-x-auto rounded-2xl border border-neutral-800 bg-black">
                        <div className="grid min-w-[1180px] grid-cols-10 border-b border-neutral-900">
                            {RELATIONSHIP_PHASES.map((phase) => (
                                <div key={phase.key} className="border-r border-neutral-900 px-3 py-3 last:border-r-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`h-2 w-2 rotate-45 ${phaseTone[phase.key].bar}`} />
                                        <p className="truncate text-xs font-medium text-neutral-300">{phase.label}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="grid min-w-[1180px] grid-cols-10">
                            {RELATIONSHIP_PHASES.map((phase) => {
                                const phaseItems = itemsByPhase.get(phase.key) ?? []
                                return (
                                    <div key={phase.key} className="min-h-72 border-r border-neutral-900 px-2 py-3 last:border-r-0">
                                        <div className={`h-1 rounded-full ${phaseItems.length ? phaseTone[phase.key].bar : "bg-neutral-900"}`} />
                                        <div className="mt-3 space-y-2">
                                            {phaseItems.length ? phaseItems.map((item) => (
                                                <Link key={item.id} href={nativeItemHref(workspace.slug, item)} className="block rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 hover:border-neutral-600">
                                                    <p className="line-clamp-2 text-sm font-medium text-neutral-100">{item.title}</p>
                                                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                                                        <span className={phaseTone[phase.key].text}>{statusText(item.status)}</span>
                                                        <span className="text-neutral-500">{formatRelativeTime(itemDate(item))}</span>
                                                    </div>
                                                </Link>
                                            )) : (
                                                <p className="pt-2 text-xs text-neutral-700">No work yet</p>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </section>

                <section className="mt-5 grid gap-3 lg:grid-cols-3">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-400">Current phase</p>
                        <p className={`mt-2 text-lg font-semibold ${phaseTone[relationship.lifecycle_phase].text}`}>{phaseLabel(relationship.lifecycle_phase)}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-400">Source</p>
                        <p className="mt-2 text-lg font-semibold capitalize">{relationship.source_type}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-400">Last updated</p>
                        <p className="mt-2 text-lg font-semibold">{formatRelativeTime(relationship.updated_at)}</p>
                    </div>
                </section>
            </div>
        </main>
    )
}

function relationshipHubHref(workspaceSlug: string, relationshipId: string) {
    return workspaceHref(workspaceSlug, `relationships/${relationshipId}`)
}
