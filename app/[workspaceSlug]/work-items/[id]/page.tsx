import Link from "next/link"
import { notFound } from "next/navigation"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import {
    getWorkItem,
    getWorkItemPlanningContext,
    getRelationship,
    listWorkItemRelationships,
    listWorkItemAssets,
    listRelationshipsForWorkspace,
    assetHref,
    onboardingDetailHref,
} from "@/lib/relationships"
import { createUploadSignedUrls } from "@/lib/onboarding/uploads"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import { InlineWorkItemFields } from "./InlineWorkItemFields"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; id: string }>
}

function statusLabel(status: string) {
    return status.replace(/_/g, " ")
}

function statusTone(status: string): "grey" | "yellow" | "green" | "red" {
    if (status === "done") return "green"
    if (status === "blocked" || status === "canceled") return "red"
    if (status === "doing" || status === "waiting") return "yellow"
    return "grey"
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
    const [relationships, assets, planning, relationshipOptions] = await Promise.all([
        listWorkItemRelationships(workspace.id, item.id),
        listWorkItemAssets(workspace.id, item.id),
        getWorkItemPlanningContext(workspace.id, item),
        listRelationshipsForWorkspace(workspace.id),
    ])
    const contextRelationshipId = relationships[0]?.relationship_id
    const contextRelationship = contextRelationshipId ? await getRelationship(workspace.id, contextRelationshipId) : null
    const onboardingRelationshipId = metadataValue(item.metadata, "relationship_id") || contextRelationshipId
    const onboardingStepKey = metadataValue(item.metadata, "step_key")
    const onboardingBackHref = item.native_kind === "onboarding_step" && onboardingRelationshipId
        ? `${onboardingDetailHref(workspace.slug, onboardingRelationshipId)}${onboardingStepKey ? `#step-${slugAnchor(onboardingStepKey)}` : ""}`
        : null
    const waitsForParent = planning.dependencies.some((dependency) => dependency.source === "parent_auto" && dependency.work_item_id === item.parent_work_item_id)
    const avatarUrls = await createUploadSignedUrls([...planning.members, ...(planning.creator ? [planning.creator] : [])].map((person) => person.avatar_path).filter((path): path is string => Boolean(path)))
    const personProps = (person: typeof planning.members[number]) => ({
        user_id: person.user_id,
        username: person.username,
        avatar_url: person.avatar_path ? avatarUrls.get(person.avatar_path) ?? null : null,
    })

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <header className="pb-4">
                            <p className="font-mono text-sm text-neutral-500">Work item {shortId(item.id)}</p>
                            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{item.title}</h1>
                        </header>

                <InlineWorkItemFields
                    workspaceSlug={workspace.slug} workItemId={item.id} status={item.status} statusLabel={statusLabel(item.status)} statusTone={statusTone(item.status)}
                    plannedStartDate={item.planned_start_date} plannedStartTime={item.planned_start_time ?? null} dueDate={item.due_date} dueTime={item.due_time ?? null} actualStartAt={item.actual_start_at} actualStartHasTime={Boolean(item.actual_start_has_time)} actualCompletedAt={item.actual_completed_at} actualCompletedHasTime={Boolean(item.actual_completed_has_time)} description={item.description}
                    assignees={planning.assignees.map(personProps)} creator={planning.creator ? personProps(planning.creator) : null} members={planning.members.map(personProps)}
                    parent={planning.parent ? { id: planning.parent.id, title: planning.parent.title, status: planning.parent.status } : null} parentId={item.parent_work_item_id ?? null} waitsForParent={waitsForParent}
                    dependencies={planning.dependencies.flatMap((dependency) => dependency.work_item ? [dependency.work_item] : [])}
                    manualDependencyIds={planning.dependencies.filter((dependency) => dependency.source === "manual").map((dependency) => dependency.work_item_id)}
                    workOptions={planning.availableWorkItems.map((candidate) => ({ id: candidate.id, title: candidate.title, status: candidate.status }))}
                    relationships={relationships.map((link) => ({ id: link.relationship_id, label: link.relationship?.business_name ?? link.relationship?.primary_person_name ?? "Relationship" }))}
                    relationshipOptions={relationshipOptions.map((relationship) => ({ id: relationship.id, label: relationship.business_name ?? relationship.primary_person_name }))}
                    relationshipsLocked={item.native_kind === "onboarding_step"} priority={item.priority}
                />

                {onboardingBackHref ? (
                    <section className="mt-6 rounded-xl border border-sky-500/20 bg-sky-950/10 p-4">
                        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                            <div><p className="text-sm font-medium text-sky-100">Onboarding step task</p><p className="mt-1 text-sm leading-6 text-sky-100/70">This task is one chapter in the client onboarding dossier.</p></div>
                            <Link href={onboardingBackHref} className="inline-flex min-h-10 items-center rounded-lg border border-sky-300/30 px-3 text-sm text-sky-100 hover:border-sky-200">Back to onboarding</Link>
                        </div>
                    </section>
                ) : null}

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
