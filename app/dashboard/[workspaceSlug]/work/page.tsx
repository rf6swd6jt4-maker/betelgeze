import Link from "next/link"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import {
    listWorkQueueItems,
    nativeItemHref,
    phaseLabel,
    relationshipHubHref,
    workspaceHref,
    type RelationshipWorkItemStatus,
} from "@/lib/relationships"
import { requireWorkspace } from "@/lib/workspaces"
import { formatRelativeTime } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

function statusTone(status: RelationshipWorkItemStatus) {
    if (status === "blocked") return "bg-red-300 text-red-200"
    if (status === "waiting") return "bg-yellow-300 text-yellow-200"
    if (status === "doing") return "bg-sky-300 text-sky-200"
    return "bg-neutral-500 text-neutral-300"
}

export default async function WorkQueuePage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const items = await listWorkQueueItems(workspace.slug, workspace.id)
    const blockedCount = items.filter((item) => item.status === "blocked").length
    const dueCount = items.filter((item) => item.planned_end_date && new Date(item.planned_end_date) <= new Date()).length

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl">
                <header className="flex flex-col justify-between gap-4 border-b border-neutral-800 pb-5 sm:flex-row sm:items-end">
                    <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                            Team queue
                        </p>
                        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                            Work Queue
                        </h1>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                            Shared next actions across Relationships. This is the start of project management without creating a separate, disconnected task universe.
                        </p>
                    </div>
                    <Link href={workspaceHref(workspace.slug, "relationships")} className="w-fit rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:border-neutral-600 hover:text-white">
                        Relationships
                    </Link>
                </header>

                <section className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                    {[
                        ["Open work", items.length],
                        ["Blocked", blockedCount],
                        ["Due/ready", dueCount],
                    ].map(([label, value]) => (
                        <div key={label} className="border-r border-neutral-800 px-3 py-3 last:border-r-0">
                            <p className="text-xs text-neutral-500">{label}</p>
                            <p className="mt-1 text-xl font-semibold">{value}</p>
                        </div>
                    ))}
                </section>

                <section className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
                    {items.length ? (
                        items.map((item) => {
                            const tone = statusTone(item.status)
                            const date = item.planned_end_date ?? item.planned_start_date ?? item.actual_start_at ?? item.created_at
                            return (
                                <div key={item.id} className="grid gap-3 border-b border-neutral-900 px-4 py-4 last:border-0 md:grid-cols-[minmax(240px,1fr)_minmax(190px,0.8fr)_150px_120px_120px] md:items-center">
                                    <div className="min-w-0">
                                        <Link href={nativeItemHref(workspace.slug, item)} className="truncate font-medium text-neutral-100 hover:text-white">
                                            {item.title}
                                        </Link>
                                        {item.description && <p className="mt-1 line-clamp-1 text-sm text-neutral-500">{item.description}</p>}
                                    </div>
                                    <Link href={relationshipHubHref(workspace.slug, item.relationship.id)} className="min-w-0 text-sm text-neutral-300 hover:text-white">
                                        <span className="block truncate">{item.relationship.primary_person_name}</span>
                                        <span className="block truncate text-xs text-neutral-500">{item.relationship.business_name ?? "No business context"}</span>
                                    </Link>
                                    <p className="text-sm text-neutral-400">{phaseLabel(item.lifecycle_phase)}</p>
                                    <div className="flex items-center gap-2 text-sm">
                                        <span className={`h-2 w-2 rotate-45 ${tone.split(" ")[0]}`} />
                                        <span className={tone.split(" ")[1]}>{item.status}</span>
                                    </div>
                                    <p className="text-sm text-neutral-500 md:text-right">{formatRelativeTime(date)}</p>
                                </div>
                            )
                        })
                    ) : (
                        <div className="p-6">
                            <p className="text-lg font-semibold">No queued work yet.</p>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                                Relationship work items will collect here as onboarding, fulfilment, lead follow-up, and future project work begin sharing the same work primitive.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </main>
    )
}
