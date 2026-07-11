import Link from "next/link"
import { notFound } from "next/navigation"
import type { ReactNode } from "react"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import { Assignee, RoundPill, Status } from "@/components/ui"
import {
    getWorkItem,
    getWorkItemPlanningContext,
    getRelationship,
    listWorkItemRelationships,
    listWorkItemAssets,
    assetHref,
    onboardingDetailHref,
    relationshipHubHref,
    workItemHref,
} from "@/lib/relationships"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import { updateWorkItemPlanning } from "./actions"

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

function compactDate(value: string | null | undefined) {
    if (!value) return "Not set"
    return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value))
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="grid min-h-10 grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-3 py-2 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
            <p className="pt-0.5 text-sm text-neutral-500">{label}</p>
            <div className="min-w-0 text-sm text-neutral-200">{children}</div>
        </div>
    )
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
    const [relationships, assets, planning] = await Promise.all([
        listWorkItemRelationships(workspace.id, item.id),
        listWorkItemAssets(workspace.id, item.id),
        getWorkItemPlanningContext(workspace.id, item),
    ])
    const contextRelationshipId = relationships[0]?.relationship_id
    const contextRelationship = contextRelationshipId ? await getRelationship(workspace.id, contextRelationshipId) : null
    const onboardingRelationshipId = metadataValue(item.metadata, "relationship_id") || contextRelationshipId
    const onboardingStepKey = metadataValue(item.metadata, "step_key")
    const onboardingBackHref = item.native_kind === "onboarding_step" && onboardingRelationshipId
        ? `${onboardingDetailHref(workspace.slug, onboardingRelationshipId)}${onboardingStepKey ? `#step-${slugAnchor(onboardingStepKey)}` : ""}`
        : null
    const selectedAssigneeIds = new Set(planning.assignees.map((person) => person.user_id))
    const manualDependencyIds = new Set(planning.dependencies.filter((dependency) => dependency.source === "manual").map((dependency) => dependency.work_item_id))
    const waitsForParent = planning.dependencies.some((dependency) => dependency.source === "parent_auto" && dependency.work_item_id === item.parent_work_item_id)
    const updatePlanningAction = updateWorkItemPlanning.bind(null, workspace.slug, item.id)

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

                <section className="mt-5 border-y border-neutral-800 py-1">
                    <div className="grid gap-x-10 lg:grid-cols-2">
                        <div className="divide-y divide-neutral-900">
                            <Field label="Status"><Status label={statusLabel(item.status)} tone={statusTone(item.status)} /></Field>
                            <Field label="Schedule">
                                {item.status === "done" ? (
                                    <span>{compactDate(item.actual_start_at)} <span className="px-2 text-neutral-600">→</span> Finished {compactDate(item.actual_completed_at)}</span>
                                ) : (
                                    <span>{compactDate(item.planned_start_date)} <span className="px-2 text-neutral-600">→</span> Due {compactDate(item.due_date)}</span>
                                )}
                            </Field>
                            <Field label="Assigned to">
                                <div className="flex flex-wrap gap-1.5">
                                    {planning.assignees.length ? planning.assignees.map((person) => <Assignee key={person.user_id} name={person.username} />) : <span className="text-neutral-600">Unassigned</span>}
                                </div>
                            </Field>
                            <Field label="Created by">
                                {planning.creator ? <Assignee name={planning.creator.username} /> : <span className="text-neutral-600">System or imported</span>}
                            </Field>
                        </div>
                        <div className="divide-y divide-neutral-900 lg:border-l lg:border-neutral-900 lg:pl-10">
                            <Field label="Parent">
                                {planning.parent ? <Link href={workItemHref(workspace.slug, planning.parent.id)} className="underline decoration-neutral-700 underline-offset-4 hover:text-white">{planning.parent.title}</Link> : <span className="text-neutral-600">None</span>}
                            </Field>
                            <Field label="Dependencies">
                                <div className="flex flex-wrap items-center gap-2">
                                    {planning.dependencies.length ? planning.dependencies.map((dependency) => dependency.work_item ? (
                                        <Link key={dependency.work_item_id} href={workItemHref(workspace.slug, dependency.work_item_id)} className="underline decoration-neutral-700 underline-offset-4 hover:text-white">
                                            {dependency.work_item.title}
                                        </Link>
                                    ) : null) : <span className="text-neutral-600">None</span>}
                                </div>
                            </Field>
                            <Field label="Relationships">
                                <div className="flex flex-wrap gap-1.5">
                                    {relationships.length ? relationships.map((link) => (
                                        <Link key={link.relationship_id} href={relationshipHubHref(workspace.slug, link.relationship_id)}>
                                            <RoundPill tone="sky">{link.relationship?.business_name ?? link.relationship?.primary_person_name ?? "Relationship"}</RoundPill>
                                        </Link>
                                    )) : <span className="text-neutral-600">Workspace only</span>}
                                </div>
                            </Field>
                            <Field label="Priority"><span className="capitalize">{item.priority === 1 ? "Urgent" : item.priority === 2 ? "High" : item.priority === 3 ? "Normal" : item.priority === 4 ? "Low" : "Lowest"}</span></Field>
                        </div>
                    </div>
                    <div className="border-t border-neutral-900 py-2 text-right text-xs text-neutral-600">Updated {formatRelativeTime(item.updated_at)} · {shortId(item.id)}</div>
                </section>

                <details className="mt-3 border-b border-neutral-900 pb-3">
                    <summary className="cursor-pointer py-2 text-sm text-neutral-500 hover:text-neutral-200">Edit work item fields</summary>
                    <form action={updatePlanningAction} className="mt-2 grid gap-5 rounded-xl border border-neutral-800 bg-neutral-950 p-4 lg:grid-cols-2">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <label className="text-sm text-neutral-400">Status
                                <select name="status" defaultValue={item.status} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-neutral-100">
                                    <option value="todo">Todo</option><option value="doing">Doing</option><option value="waiting">Waiting</option><option value="blocked">Blocked</option><option value="done">Done</option><option value="canceled">Canceled</option>
                                </select>
                            </label>
                            <label className="text-sm text-neutral-400">Parent
                                <select name="parent_work_item_id" defaultValue={item.parent_work_item_id ?? ""} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-neutral-100">
                                    <option value="">No parent</option>
                                    {planning.availableWorkItems.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
                                </select>
                            </label>
                            <label className="text-sm text-neutral-400">Start date<input name="planned_start_date" type="date" defaultValue={item.planned_start_date ?? ""} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-neutral-100" /></label>
                            <label className="text-sm text-neutral-400">Due date<input name="due_date" type="date" defaultValue={item.due_date ?? ""} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-neutral-100" /></label>
                            <label className="flex items-center gap-2 text-sm text-neutral-300 sm:col-span-2">
                                <input name="wait_for_parent" type="checkbox" defaultChecked={waitsForParent || !item.parent_work_item_id} className="h-4 w-4 rounded border-neutral-700 bg-black" /> Wait for parent
                            </label>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <fieldset>
                                <legend className="text-sm text-neutral-400">Assigned to</legend>
                                <div className="mt-1.5 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-neutral-800 p-2">
                                    {planning.members.map((person) => <label key={person.user_id} className="flex items-center gap-2 rounded px-1 py-1 text-sm text-neutral-300 hover:bg-neutral-900"><input name="assignee_ids" value={person.user_id} type="checkbox" defaultChecked={selectedAssigneeIds.has(person.user_id)} /> {person.username}</label>)}
                                    {!planning.members.length ? <p className="px-1 py-1 text-sm text-neutral-600">No workspace members found</p> : null}
                                </div>
                            </fieldset>
                            <fieldset>
                                <legend className="text-sm text-neutral-400">Depends on</legend>
                                <div className="mt-1.5 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-neutral-800 p-2">
                                    {planning.availableWorkItems.map((candidate) => <label key={candidate.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm text-neutral-300 hover:bg-neutral-900"><input name="dependency_ids" value={candidate.id} type="checkbox" defaultChecked={manualDependencyIds.has(candidate.id)} /> <span className="truncate">{candidate.title}</span></label>)}
                                    {!planning.availableWorkItems.length ? <p className="px-1 py-1 text-sm text-neutral-600">No other work items</p> : null}
                                </div>
                            </fieldset>
                        </div>
                        <div className="flex justify-end lg:col-span-2"><button className="min-h-10 rounded-lg bg-white px-4 text-sm font-medium text-black">Save fields</button></div>
                    </form>
                </details>

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
