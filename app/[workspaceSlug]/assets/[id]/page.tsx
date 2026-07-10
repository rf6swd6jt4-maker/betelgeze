/* eslint-disable @next/next/no-img-element */

import Link from "next/link"
import { notFound } from "next/navigation"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import {
    getAsset,
    getRelationship,
    listAssetRelationships,
    listAssetWorkItems,
    relationshipHubHref,
    workItemHref,
} from "@/lib/relationships"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; id: string }>
}

function formatFileSize(size: number | null) {
    if (!size) return "Unknown size"
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function isImage(contentType: string | null) {
    return Boolean(contentType?.startsWith("image/"))
}

function isVideo(contentType: string | null) {
    return Boolean(contentType?.startsWith("video/"))
}

function isAudio(contentType: string | null) {
    return Boolean(contentType?.startsWith("audio/"))
}

function isPdf(contentType: string | null, title: string) {
    return contentType === "application/pdf" || title.toLowerCase().endsWith(".pdf")
}

function responseEntries(metadata: Record<string, unknown>) {
    const response = metadata.response
    if (!response || typeof response !== "object" || Array.isArray(response)) return []
    return Object.entries(response as Record<string, unknown>).map(([key, value]) => ({
        key,
        value,
    }))
}

export default async function AssetDetailPage({ params }: PageProps) {
    const { workspaceSlug, id } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const asset = await getAsset(workspace.id, id)
    if (!asset) notFound()
    const [relationships, workItems] = await Promise.all([
        listAssetRelationships(workspace.id, asset.id),
        listAssetWorkItems(workspace.id, asset.id),
    ])
    const contextRelationshipId = relationships[0]?.relationship_id
    const contextRelationship = contextRelationshipId ? await getRelationship(workspace.id, contextRelationshipId) : null
    const previewUrl = asset.storage_path ? await createUploadSignedUrl(asset.storage_path) : asset.external_url
    const formEntries = asset.asset_kind === "form_submission" ? responseEntries(asset.metadata) : []

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <header className="border-b border-neutral-800 pb-6">
                            <p className="font-mono text-sm text-neutral-500">{asset.asset_kind.replace(/_/g, " ")} asset {shortId(asset.id)}</p>
                            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{asset.title}</h1>
                            {asset.description && <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">{asset.description}</p>}
                        </header>

                <section className="mt-6">
                    <div className="min-h-[24rem] overflow-hidden rounded-xl border border-neutral-800 bg-black">
                        {formEntries.length > 0 && (
                            <div className="divide-y divide-neutral-900">
                                {formEntries.map((entry) => (
                                    <div key={entry.key} className="px-5 py-4">
                                        <p className="text-sm font-medium capitalize text-neutral-400">{entry.key.replace(/_/g, " ")}</p>
                                        {Array.isArray(entry.value) ? (
                                            <p className="mt-2 text-sm text-neutral-200">{entry.value.length} uploaded file{entry.value.length === 1 ? "" : "s"}</p>
                                        ) : (
                                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-100">{String(entry.value || "No answer provided")}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        {previewUrl && isImage(asset.content_type) && (
                            <img src={previewUrl} alt={asset.title} className="max-h-[70vh] w-full object-contain" />
                        )}
                        {previewUrl && isVideo(asset.content_type) && (
                            <video controls src={previewUrl} className="max-h-[70vh] w-full bg-black" />
                        )}
                        {previewUrl && isAudio(asset.content_type) && (
                            <div className="flex min-h-[18rem] items-center justify-center p-6">
                                <audio controls src={previewUrl} className="w-full" />
                            </div>
                        )}
                        {previewUrl && isPdf(asset.content_type, asset.title) && (
                            <iframe src={previewUrl} title={asset.title} className="h-[70vh] w-full border-0 bg-white" />
                        )}
                        {previewUrl && !isImage(asset.content_type) && !isVideo(asset.content_type) && !isAudio(asset.content_type) && !isPdf(asset.content_type, asset.title) && (
                            <div className="flex min-h-[24rem] flex-col items-center justify-center px-6 text-center">
                                <p className="text-lg font-semibold">Preview is not available for this file type.</p>
                                <a href={previewUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-white px-4 text-sm font-medium text-black">
                                    Open file
                                </a>
                            </div>
                        )}
                        {!previewUrl && formEntries.length === 0 && (
                            <div className="flex min-h-[24rem] flex-col items-center justify-center px-6 text-center">
                                <p className="text-lg font-semibold">Native asset</p>
                                <p className="mt-2 max-w-md text-sm leading-6 text-neutral-400">
                                    This asset is generated from Betelgeze data and does not have a stored file preview yet.
                                </p>
                            </div>
                        )}
                    </div>
                </section>

                <section className="mt-6 grid gap-4 lg:grid-cols-3">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <h2 className="font-semibold">Details</h2>
                        <dl className="mt-3 space-y-3 text-sm">
                            <div><dt className="text-neutral-500">Asset ID</dt><dd className="mt-1 font-mono text-neutral-200">{shortId(asset.id)}</dd></div>
                            <div><dt className="text-neutral-500">Source</dt><dd className="mt-1 capitalize text-neutral-200">{asset.source_kind.replace(/_/g, " ")}</dd></div>
                            <div><dt className="text-neutral-500">Type</dt><dd className="mt-1 text-neutral-200">{asset.content_type ?? "Native record"}</dd></div>
                            <div><dt className="text-neutral-500">Size</dt><dd className="mt-1 text-neutral-200">{formatFileSize(asset.file_size)}</dd></div>
                            <div><dt className="text-neutral-500">Updated</dt><dd className="mt-1 text-neutral-200">{formatRelativeTime(asset.updated_at)}</dd></div>
                        </dl>
                    </div>

                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <h2 className="font-semibold">Relationships</h2>
                        <div className="mt-3 space-y-2">
                            {relationships.length ? relationships.map((link) => (
                                <Link key={link.relationship_id} href={relationshipHubHref(workspace.slug, link.relationship_id)} className="block rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:border-neutral-600">
                                    <span className="block text-neutral-100">{link.relationship?.primary_person_name ?? "Relationship"}</span>
                                    <span className="mt-1 block text-neutral-500">{link.relationship?.business_name ?? "No business context"}</span>
                                    <span className="mt-1 block font-mono text-xs text-neutral-600">ID {shortId(link.relationship_id)}</span>
                                </Link>
                            )) : <p className="text-sm text-neutral-500">Workspace-only asset.</p>}
                        </div>
                    </div>

                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <h2 className="font-semibold">Work items</h2>
                        <div className="mt-3 space-y-2">
                            {workItems.length ? workItems.map((link) => (
                                <Link key={link.work_item_id} href={workItemHref(workspace.slug, link.work_item_id)} className="block rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:border-neutral-600">
                                    <span className="block text-neutral-100">{link.work_item?.title ?? "Work item"}</span>
                                    <span className="mt-1 block capitalize text-neutral-500">{link.work_item?.status ?? "Linked"}</span>
                                    <span className="mt-1 block font-mono text-xs text-neutral-600">ID {shortId(link.work_item_id)}</span>
                                </Link>
                            )) : <p className="text-sm text-neutral-500">Not attached to work yet.</p>}
                        </div>
                    </div>
                </section>
                    </div>

                    <ClientContextPanel
                        workspaceSlug={workspace.slug}
                        relationship={contextRelationship}
                        metrics={[
                            { label: "Asset", value: asset.asset_kind.replace(/_/g, " ") },
                            { label: "Links", value: relationships.length + workItems.length },
                        ]}
                    />
                </div>
            </div>
        </main>
    )
}
