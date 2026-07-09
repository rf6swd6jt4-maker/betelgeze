import Link from "next/link"
import { notFound } from "next/navigation"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import {
    RELATIONSHIP_PHASES,
    getRelationship,
    listRelationshipAssets,
    listRelationshipTimelineItems,
    nativeItemHref,
    phaseLabel,
    relationshipIndustryLabel,
    relationshipHubHref,
    relationshipLocationLabel,
    workspaceHref,
    type RelationshipPhase,
    type RelationshipAsset,
    type RelationshipWorkItem,
} from "@/lib/relationships"
import { requireWorkspace } from "@/lib/workspaces"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { createRelationshipAsset, createRelationshipWorkItem, startRelationshipOnboarding } from "../actions"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; relationshipId: string }>
    searchParams: Promise<{ view?: string }>
}

const phaseTone: Record<RelationshipPhase, { bar: string; text: string }> = {
    lead: { bar: "bg-sky-400", text: "text-sky-200" },
    nurturing: { bar: "bg-fuchsia-300", text: "text-fuchsia-200" },
    potential_client: { bar: "bg-yellow-300", text: "text-yellow-200" },
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

function assetTypeLabel(type: RelationshipAsset["asset_type"]) {
    return type.replace(/_/g, " ")
}

export default async function RelationshipHubPage({ params, searchParams }: PageProps) {
    const { workspaceSlug, relationshipId } = await params
    const { view } = await searchParams
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const relationship = await getRelationship(workspace.id, relationshipId)
    if (!relationship) notFound()
    const [allItems, assets] = await Promise.all([
        listRelationshipTimelineItems(workspace.slug, relationship),
        listRelationshipAssets(workspace.id, relationship.id),
    ])
    const showAll = view === "all"
    const visibleItems = showAll ? allItems : allItems.filter((item) => item.is_key_task)
    const openItems = allItems.filter((item) => !["done", "canceled"].includes(item.status))
    const industry = relationshipIndustryLabel(relationship.industry_value)
    const location = relationshipLocationLabel(relationship)

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
                        {!relationship.client_id && relationship.lifecycle_phase !== "completed_lost" && (
                            <form action={startRelationshipOnboarding.bind(null, workspace.slug, relationship.id)}>
                                <button className="rounded-lg bg-white px-3 py-2 font-medium text-black">
                                    Start onboarding
                                </button>
                            </form>
                        )}
                        <Link href={workspaceHref(workspace.slug, `sales/new?relationshipId=${relationship.id}`)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:border-neutral-600 hover:text-white">
                            Create invoice
                        </Link>
                    </div>
                </div>

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

                <section className="mt-5 grid gap-3 lg:grid-cols-3">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-400">Company</p>
                        <p className="mt-2 text-lg font-semibold">{relationship.business_name ?? "No company saved"}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-400">Industry</p>
                        <p className="mt-2 text-lg font-semibold capitalize">{industry ?? "Unset"}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-400">Location</p>
                        <p className="mt-2 text-lg font-semibold capitalize">{location ?? "Unset"}</p>
                    </div>
                </section>

                {relationship.notes_summary && (
                    <section className="mt-5 rounded-2xl border border-neutral-800 bg-black p-5">
                        <h2 className="text-lg font-semibold">Context</h2>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-300">{relationship.notes_summary}</p>
                    </section>
                )}

                <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
                    <div className="min-w-0 rounded-2xl border border-neutral-800 bg-black">
                        <div className="flex items-center justify-between gap-3 border-b border-neutral-900 px-4 py-3">
                            <div>
                                <h2 className="font-semibold">Relationship work</h2>
                                <p className="mt-1 text-xs text-neutral-500">{openItems.length} open · {visibleItems.length} visible</p>
                            </div>
                        </div>
                        <div className="divide-y divide-neutral-900">
                            {visibleItems.length ? visibleItems.map((item) => (
                                <Link key={item.id} href={nativeItemHref(workspace.slug, item)} className="grid gap-2 px-4 py-3 hover:bg-neutral-900/60 sm:grid-cols-[minmax(0,1fr)_140px_120px] sm:items-center">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-neutral-100">{item.title}</p>
                                        {item.description && <p className="mt-1 line-clamp-1 text-xs text-neutral-500">{item.description}</p>}
                                    </div>
                                    <p className="text-sm text-neutral-400">{phaseLabel(item.lifecycle_phase)}</p>
                                    <div className="flex items-center justify-between gap-2 text-xs sm:justify-end">
                                        <span className={phaseTone[item.lifecycle_phase].text}>{statusText(item.status)}</span>
                                        <span className="text-neutral-500">{formatRelativeTime(itemDate(item))}</span>
                                    </div>
                                </Link>
                            )) : (
                                <p className="px-4 py-8 text-sm text-neutral-500">No work items yet.</p>
                            )}
                        </div>
                    </div>

                    <form action={createRelationshipWorkItem.bind(null, workspace.slug, relationship.id)} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                        <h2 className="font-semibold">Add task</h2>
                        <label className="mt-4 block text-sm text-neutral-300">
                            Task
                            <input name="title" required className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" />
                        </label>
                        <label className="mt-3 block text-sm text-neutral-300">
                            Stage
                            <select name="lifecycle_phase" defaultValue={relationship.lifecycle_phase} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white">
                                {RELATIONSHIP_PHASES.map((phase) => <option key={phase.key} value={phase.key}>{phase.label}</option>)}
                            </select>
                        </label>
                        <label className="mt-3 block text-sm text-neutral-300">
                            Notes
                            <textarea name="description" rows={3} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" />
                        </label>
                        <label className="mt-3 flex items-center gap-2 text-sm text-neutral-300">
                            <input name="is_key_task" type="checkbox" defaultChecked />
                            Key task
                        </label>
                        <button className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-black">Add task</button>
                    </form>
                </section>

                <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
                    <div className="min-w-0 rounded-2xl border border-neutral-800 bg-black">
                        <div className="border-b border-neutral-900 px-4 py-3">
                            <h2 className="font-semibold">Assets</h2>
                            <p className="mt-1 text-xs text-neutral-500">Files, submissions, notes, invoices, messages, links, and lead evidence attached to this relationship.</p>
                        </div>
                        <div className="divide-y divide-neutral-900">
                            {assets.length ? assets.map((asset) => (
                                <div key={asset.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[130px_minmax(0,1fr)_110px] sm:items-center">
                                    <p className="text-sm capitalize text-neutral-400">{assetTypeLabel(asset.asset_type)}</p>
                                    <div className="min-w-0">
                                        {asset.external_url ? (
                                            <a href={asset.external_url} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-neutral-100 underline underline-offset-4">{asset.title}</a>
                                        ) : (
                                            <p className="truncate text-sm font-medium text-neutral-100">{asset.title}</p>
                                        )}
                                        {asset.description && <p className="mt-1 line-clamp-1 text-xs text-neutral-500">{asset.description}</p>}
                                    </div>
                                    <p className="text-xs text-neutral-500 sm:text-right">{formatRelativeTime(asset.created_at)}</p>
                                </div>
                            )) : (
                                <p className="px-4 py-8 text-sm text-neutral-500">No assets yet.</p>
                            )}
                        </div>
                    </div>

                    <form action={createRelationshipAsset.bind(null, workspace.slug, relationship.id)} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                        <h2 className="font-semibold">Attach asset</h2>
                        <label className="mt-4 block text-sm text-neutral-300">
                            Title
                            <input name="title" required className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" />
                        </label>
                        <label className="mt-3 block text-sm text-neutral-300">
                            Type
                            <select name="asset_type" defaultValue="link" className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white">
                                {["link", "note", "document", "file", "invoice", "form_submission", "message", "lead_evidence", "other"].map((type) => <option key={type} value={type}>{assetTypeLabel(type as RelationshipAsset["asset_type"])}</option>)}
                            </select>
                        </label>
                        <label className="mt-3 block text-sm text-neutral-300">
                            URL
                            <input name="external_url" type="url" className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" />
                        </label>
                        <label className="mt-3 block text-sm text-neutral-300">
                            Details
                            <textarea name="description" rows={3} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" />
                        </label>
                        <button className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-black">Attach asset</button>
                    </form>
                </section>
            </div>
        </main>
    )
}
