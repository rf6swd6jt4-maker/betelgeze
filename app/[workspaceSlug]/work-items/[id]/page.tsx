import Link from "next/link"
import { notFound } from "next/navigation"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import {
    getWorkItem,
    getRelationship,
    listWorkItemRelationships,
    listWorkItemAssets,
    phaseLabel,
    assetHref,
    onboardingDetailHref,
    relationshipHubHref,
} from "@/lib/relationships"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; id: string }>
}

function statusLabel(status: string) {
    return status.replace(/_/g, " ")
}

function metadataValue(metadata: unknown, key: string) {
    return metadata && typeof metadata === "object" && key in metadata
        ? String((metadata as Record<string, unknown>)[key] ?? "")
        : ""
}

function slugAnchor(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "step"
}

export default async function WorkItemDetailPage({ params }: PageProps) {
    const { workspaceSlug, id } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const item = await getWorkItem(workspace.id, id)
    if (!item) notFound()
    const [relationships, assets] = await Promise.all([
        listWorkItemRelationships(workspace.id, item.id),
        listWorkItemAssets(workspace.id, item.id),
    ])
    const contextRelationshipId = relationships[0]?.relationship_id
    const contextRelationship = contextRelationshipId ? await getRelationship(workspace.id, contextRelationshipId) : null
    const onboardingRelationshipId = metadataValue(item.metadata, "relationship_id") || contextRelationshipId
    const onboardingStepKey = metadataValue(item.metadata, "step_key")
    const onboardingBackHref = item.native_kind === "onboarding_step" && onboardingRelationshipId
        ? `${onboardingDetailHref(workspace.slug, onboardingRelationshipId)}${onboardingStepKey ? `#step-${slugAnchor(onboardingStepKey)}` : ""}`
        : null

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <header className="border-b border-neutral-800 pb-6">
                            <p className="font-mono text-sm text-neutral-500">Work item {shortId(item.id)}</p>
                            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{item.title}</h1>
                            {item.description && <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">{item.description}</p>}
                        </header>

                        {onboardingBackHref ? (
                            <section className="mt-6 rounded-xl border border-sky-500/20 bg-sky-950/10 p-4">
                                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                                    <div>
                                        <p className="text-sm font-medium text-sky-100">Onboarding step task</p>
                                        <p className="mt-1 text-sm leading-6 text-sky-100/70">This task is one chapter in the client onboarding dossier.</p>
                                    </div>
                                    <Link href={onboardingBackHref} className="inline-flex min-h-10 items-center rounded-lg border border-sky-300/30 px-3 text-sm text-sky-100 hover:border-sky-200">
                                        Back to onboarding
                                    </Link>
                                </div>
                            </section>
                        ) : null}

                <section className="mt-6 grid gap-3 sm:grid-cols-5">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Reference</p>
                        <p className="mt-2 font-mono font-medium">{shortId(item.id)}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Status</p>
                        <p className="mt-2 font-medium capitalize">{statusLabel(item.status)}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Lifecycle</p>
                        <p className="mt-2 font-medium">{phaseLabel(item.lifecycle_phase)}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Start</p>
                        <p className="mt-2 font-medium">{item.planned_start_date ?? "Not set"}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Due</p>
                        <p className="mt-2 font-medium">{item.due_date ?? "Not set"}</p>
                    </div>
                </section>

                <section className="mt-6 rounded-2xl border border-neutral-800 bg-black p-5">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div>
                            <h2 className="text-lg font-semibold">Relationship links</h2>
                            <p className="mt-1 text-sm text-neutral-500">This workspace-native task can be attached to relationships as needed.</p>
                        </div>
                        <span className="text-sm text-neutral-500">Updated {formatRelativeTime(item.updated_at)}</span>
                    </div>
                    <div className="mt-4 divide-y divide-neutral-900 rounded-xl border border-neutral-900">
                        {relationships.length ? relationships.map((link) => (
                            <Link key={link.relationship_id} href={relationshipHubHref(workspace.slug, link.relationship_id)} className="block px-3 py-3 hover:bg-neutral-900/70">
                                <p className="font-medium text-neutral-100">{link.relationship?.primary_person_name ?? "Relationship"}</p>
                                <p className="mt-1 text-sm text-neutral-500">{link.relationship?.business_name ?? "No business context"}</p>
                                <p className="mt-1 font-mono text-xs text-neutral-600">{shortId(link.relationship_id)}</p>
                            </Link>
                        )) : (
                            <p className="px-3 py-4 text-sm text-neutral-500">This work item is workspace-only right now.</p>
                        )}
                    </div>
                </section>

                <section className="mt-6 rounded-2xl border border-neutral-800 bg-black p-5">
                    <h2 className="text-lg font-semibold">Assets and updates</h2>
                    <div className="mt-4 divide-y divide-neutral-900 rounded-xl border border-neutral-900">
                        {assets.length ? assets.map((asset) => (
                            <Link key={asset.id} href={assetHref(workspace.slug, asset.id)} className="grid gap-2 px-3 py-3 hover:bg-neutral-900/70 sm:grid-cols-[1fr_120px] sm:items-center">
                                <div className="min-w-0">
                                    <p className="truncate font-medium text-neutral-100">{asset.title}</p>
                                    <p className="mt-1 font-mono text-xs text-neutral-600">{shortId(asset.id)}</p>
                                </div>
                                <p className="text-sm text-neutral-500 sm:text-right">{formatRelativeTime(asset.updated_at)}</p>
                            </Link>
                        )) : (
                            <p className="px-3 py-4 text-sm text-neutral-500">No assets are attached to this work item yet.</p>
                        )}
                    </div>
                </section>

                        <section className="mt-6 rounded-2xl border border-red-500/20 bg-red-950/10 p-5">
                            <h2 className="text-lg font-semibold text-red-100">Danger zone placeholder</h2>
                            <p className="mt-2 text-sm leading-6 text-red-100/70">
                                Archive/delete controls for work items will be added in a later focused pass.
                            </p>
                        </section>
                    </div>

                    <ClientContextPanel
                        workspaceSlug={workspace.slug}
                        relationship={contextRelationship}
                        metrics={[
                            { label: "Status", value: statusLabel(item.status) },
                            { label: "Assets", value: assets.length },
                        ]}
                    />
                </div>
            </div>
        </main>
    )
}
