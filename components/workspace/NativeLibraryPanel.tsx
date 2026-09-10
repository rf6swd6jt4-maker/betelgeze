/* eslint-disable @next/next/no-img-element */
"use client"

import Link from "@/components/workspace/WorkspaceLink"
import { LibraryTabs } from "@/components/library/LibraryTabs"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { workItemStatusPresentation } from "@/components/list/work-item-presentation"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { InstantFilterResults } from "@/components/panel/InstantFilterResults"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { RelationshipStage, SquarePill, RoundPill, Status } from "@/components/ui"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { InlineWorkItemFields } from "@/app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { serializeWorkspaceDetailPreview } from "@/lib/workspace-detail-preview"
import { workItemPriorityLabel } from "@/lib/work-item-priority"
import type { NativeLibrarySnapshot } from "@/lib/workspace-native-library"
import { useSearchParams } from "./WorkspaceNavigation"

const workspaceHref = (slug: string, suffix: string) => `/${slug}/${suffix}`
const assetHref = (slug: string, id: string) => `/${slug}/assets/${id}`
const workItemHref = (slug: string, id: string) => `/${slug}/work-items/${id}`
const relationshipHubHref = (slug: string, id: string) => `/${slug}/relationships/${id}`

function formatFileSize(size: number | null, fallback = "Unknown size") {
    if (!size) return fallback
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
}
function isImage(contentType: string | null) { return Boolean(contentType?.startsWith("image/")) }
function isVideo(contentType: string | null) { return Boolean(contentType?.startsWith("video/")) }
function isAudio(contentType: string | null) { return Boolean(contentType?.startsWith("audio/")) }
function isPdf(contentType: string | null, title: string) { return contentType === "application/pdf" || title.toLowerCase().endsWith(".pdf") }

function Assets({ data }: { data: Extract<NativeLibrarySnapshot, { kind: "assets" }> }) {
    const { previewEntries, counts } = data
    return (
        <main className="min-h-full bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <div className="mx-auto max-w-7xl">
                <PanelTabHeader
                    title="Assets"
                    description="Workspace files and media available for relationship and work-item use."
                    actions={<Link href={workspaceHref(data.workspaceSlug, "assets?create=asset")} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3">New asset</Link>}
                    tabs={<LibraryTabs workspaceSlug={data.workspaceSlug} active="assets" />}
                />

                <QuickStats ariaLabel="Asset statistics" items={[
                    { label: "Total", value: counts.total, hideOnMobile: true },
                    { label: "Images", value: counts.images },
                    { label: "Documents", value: counts.documents },
                    { label: "Uploads", value: counts.uploads },
                ]} />

                <section className="mt-5">
                    {previewEntries.length ? (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                            {previewEntries.map(({ asset, previewUrl }) => (
                                <Link
                                    key={asset.id}
                                    href={assetHref(data.workspaceSlug, asset.id)}
                                    prefetch={false}
                                    data-workspace-detail-preview={serializeWorkspaceDetailPreview({
                                        category: "Asset",
                                        reference: shortId(asset.id),
                                        title: asset.title,
                                        updated: formatRelativeTime(asset.updated_at),
                                    })}
                                    className="group overflow-hidden rounded-xl border border-neutral-800 bg-black hover:border-neutral-600"
                                >
                                    <div className="aspect-[4/3] bg-neutral-900">
                                        {previewUrl ? (
                                            <img src={previewUrl} alt={asset.title} className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
                                        ) : (
                                            <div className="h-full bg-neutral-900" />
                                        )}
                                    </div>
                                    <div className="p-4">
                                        <p className="truncate font-medium text-neutral-100">{asset.title}</p>
                                        <p className="mt-1 font-mono text-xs text-neutral-600">{shortId(asset.id)}</p>
                                        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-neutral-500">
                                            <span className="truncate">{formatRelativeTime(asset.updated_at)}</span>
                                            <span className="shrink-0">{formatFileSize(asset.file_size, "No file size")}</span>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-neutral-800 bg-black p-6">
                            <p className="text-lg font-semibold">No assets yet.</p>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                                Upload files from here or attach assets from relationship and work item pages.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </main>
    )
}

function AssetDetail({ data }: { data: Extract<NativeLibrarySnapshot, { kind: "asset-detail" }> }) {
    const { asset, role, scopedRelationships, scopedWorkItems, onboardingBackHref, downloadHref, previewUrl, formEntries } = data
    return (
        <main className="min-h-full bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <DetailPageHeader
                            category="Asset"
                            reference={shortId(asset.id)}
                            title={asset.title}
                            labels={<SquarePill>{asset.asset_kind.replace(/_/g, " ")}</SquarePill>}
                            facts={[{ label: scopedRelationships.length + scopedWorkItems.length === 1 ? "link" : "links", value: scopedRelationships.length + scopedWorkItems.length }]}
                            updated={formatRelativeTime(asset.updated_at)}
                        />

                        <DetailFields>
                            <DetailField label="Type" icon="file">{asset.content_type ?? asset.asset_kind.replace(/_/g, " ")}</DetailField>
                            <DetailField label="Size" icon="size" className="lg:border-l lg:border-neutral-900 lg:pl-8">{formatFileSize(asset.file_size)}</DetailField>
                            <DetailField label="Source" icon="source">{asset.source_kind.replace(/_/g, " ")}</DetailField>
                            <DetailField label="Reference" icon="identity" className="lg:border-l lg:border-neutral-900 lg:pl-8"><span className="font-mono">{shortId(asset.id)}</span></DetailField>
                            <DetailField label="Relationships" icon="relationship" className="lg:col-span-2">
                                <div className="flex flex-wrap gap-1.5">
                                    {scopedRelationships.length ? scopedRelationships.map((link) => role === "staff" ? <RoundPill key={link.relationship_id} tone="sky">{link.relationship?.business_name ?? link.relationship?.primary_person_name ?? "Relationship"}</RoundPill> : <Link key={link.relationship_id} href={relationshipHubHref(data.workspaceSlug, link.relationship_id)}><RoundPill tone="sky">{link.relationship?.business_name ?? link.relationship?.primary_person_name ?? "Relationship"}</RoundPill></Link>) : <span className="text-neutral-600">Workspace only</span>}
                                </div>
                            </DetailField>
                            <DetailField label="Work items" icon="activity" className="lg:col-span-2">
                                <div className="flex flex-wrap gap-1.5">
                                    {scopedWorkItems.length ? scopedWorkItems.map((link) => <Link key={link.work_item_id} href={workItemHref(data.workspaceSlug, link.work_item_id)}><RoundPill tone="sky">{link.work_item?.title ?? "Work item"}</RoundPill></Link>) : <span className="text-neutral-600">None</span>}
                                </div>
                            </DetailField>
                            <DetailField label="Description" icon="description" className="lg:col-span-2">{asset.description || <span className="text-neutral-600">No description</span>}</DetailField>
                        </DetailFields>

                        {onboardingBackHref ? (
                            <section className="mt-6 rounded-xl border border-sky-500/20 bg-sky-950/10 p-4">
                                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                                    <div>
                                        <p className="text-sm font-medium text-sky-100">Onboarding asset</p>
                                        <p className="mt-1 text-sm leading-6 text-sky-100/70">This asset belongs to a client onboarding chapter.</p>
                                    </div>
                                    <Link href={onboardingBackHref} className="inline-flex min-h-10 items-center rounded-lg border border-sky-300/30 px-3 text-sm text-sky-100 hover:border-sky-200">
                                        Back to onboarding
                                    </Link>
                                </div>
                            </section>
                        ) : null}

                <section className="mt-6">
                    {downloadHref ? <a href={downloadHref} target="_blank" rel="noreferrer" className="mb-4 inline-flex min-h-11 items-center rounded-lg bg-white px-4 text-sm font-medium text-black">Download file</a> : null}
                    <div className="min-h-[24rem] overflow-hidden rounded-xl border border-neutral-800 bg-black">
                        {formEntries.length > 0 && (
                            <div className="divide-y divide-neutral-900">
                                {formEntries.map((entry) => (
                                    <div key={entry.key} className="px-5 py-4">
                                        <p className="text-sm font-medium capitalize text-neutral-400">{entry.key.replace(/_/g, " ")}</p>
                                        {entry.fileCount !== null ? (
                                            <p className="mt-2 text-sm text-neutral-200">{entry.fileCount} uploaded file{entry.fileCount === 1 ? "" : "s"}</p>
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
                                <a href={downloadHref ?? previewUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-white px-4 text-sm font-medium text-black">
                                    {downloadHref ? "Download file" : "Open file"}
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

                        {role === "owner" || role === "admin" ? <DetailDangerZone>
                            <DetailDangerAction title="Archive asset" description="Archive will remove this asset from active library views while preserving its links and provenance." control={<DetailDangerButton type="button" disabled>Archive asset</DetailDangerButton>} />
                            <DetailDangerAction title="Delete asset permanently" description="Permanent deletion will be enabled after archive storage and linked-record safeguards are implemented." control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>} />
                        </DetailDangerZone> : null}
                    </div>
                    {data.context ? <aside data-native-context-spacer aria-hidden="true" className="hidden w-80 shrink-0 lg:block" /> : null}
                </div>
            </div>
        </main>
    )
}

function WorkItems({ data }: { data: Extract<NativeLibrarySnapshot, { kind: "work-items" }> }) {
    const query = useSearchParams()
    const { items } = data
    const openItems = items.filter((item) => !["done", "canceled"].includes(item.status))
    const completedItems = items.filter((item) => ["done", "canceled"].includes(item.status))
    const blockedItems = items.filter((item) => item.status === "blocked")
    const dueCount = openItems.filter((item) => item.due_date && new Date(item.due_date) <= new Date()).length
    const state = query.get("state")
    const selectedState = state && ["open", "blocked", "completed"].includes(state) ? state : null
    const filterHref = (state: string | null) => workspaceHref(data.workspaceSlug, `work-items${state ? `?state=${state}` : ""}`)
    return (
        <main className="min-h-full bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <div className="mx-auto max-w-7xl">
                <PanelTabHeader
                    title="Work Items"
                    description="Workspace tasks ordered by their most recent update."
                    actions={<Link href={workspaceHref(data.workspaceSlug, "work-items?create=work-item")} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3">New work item</Link>}
                    tabs={<LibraryTabs workspaceSlug={data.workspaceSlug} active="work-items" />}
                />

                <QuickStats ariaLabel="Work item statistics" items={[
                    { label: "Total", value: items.length, hideOnMobile: true },
                    { label: "Open", value: openItems.length },
                    { label: "Blocked", value: blockedItems.length },
                    { label: "Due/ready", value: dueCount },
                ]} />

                <FilterRail ariaLabel="Filter work items by state">
                    <FilterRailLink href={filterHref(null)} selected={!selectedState} instant={{ param: "state", value: null }}>All <FilterRailCount>{items.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("open")} selected={selectedState === "open"} instant={{ param: "state", value: "open" }}>Open <FilterRailCount>{openItems.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("blocked")} selected={selectedState === "blocked"} instant={{ param: "state", value: "blocked" }}>Blocked <FilterRailCount>{blockedItems.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("completed")} selected={selectedState === "completed"} instant={{ param: "state", value: "completed" }}>Completed <FilterRailCount>{completedItems.length}</FilterRailCount></FilterRailLink>
                </FilterRail>

                <List ariaLabel="Work items">
                    <InstantFilterResults filters={[{ param: "state" }]} items={items.map((item) => {
                        const href = workItemHref(data.workspaceSlug, item.id)
                        const status = workItemStatusPresentation(item.status)
                        const date = item.due_date ?? item.planned_start_date ?? item.actual_start_at ?? item.updated_at
                        const creator = item.creator
                        const creatorAvatarSrc = creator?.avatar ?? null
                        const actions = [{ label: "Open work item", href }]
                        const filterStates = [
                            !["done", "canceled"].includes(item.status) ? "open" : null,
                            item.status === "blocked" ? "blocked" : null,
                            ["done", "canceled"].includes(item.status) ? "completed" : null,
                        ].filter((value): value is string => Boolean(value))
                        return { id: item.id, values: { state: filterStates }, content: <ListItem detailPreview={{
                            category: "Work item",
                            reference: shortId(item.id),
                            title: item.title,
                            updated: formatRelativeTime(item.updated_at),
                        }}>
                            <MobileListActionSurface actions={actions} label={`Open actions for ${item.title}`}>
                                <ListPrimaryRow>
                                    <ListTitle href={href} className="flex-1">{item.title}</ListTitle>
                                    {item.is_key_task ? <SquarePill className="shrink-0">Key task</SquarePill> : null}
                                    <span className="hidden shrink-0 md:inline-flex"><RelationshipStage phase={item.lifecycle_phase} /></span>
                                    <Status label={status.label} tone={status.tone} className="ml-auto shrink-0" />
                                </ListPrimaryRow>
                                <ListSecondaryRow>
                                    {item.description ? <span className="hidden min-w-0 flex-1 truncate text-neutral-400 lg:inline">{item.description}</span> : null}
                                    <span className="hidden shrink-0 text-neutral-500 md:inline">{workItemPriorityLabel(item.priority)}</span>
                                    <ListTrailing>
                                        <span className="font-mono text-neutral-500">{shortId(item.id)}</span>
                                        <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(date)}</span>
                                        <ListCreatorBadge src={creatorAvatarSrc} username={creator?.username ?? null} label="Created by" date={new Date(item.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} />
                                        <ListActionMenu actions={actions} className="hidden sm:block" />
                                    </ListTrailing>
                                </ListSecondaryRow>
                            </MobileListActionSurface>
                        </ListItem> }
                    })} empty={<div className="p-6">
                        <p className="text-lg font-semibold">No work items match this state.</p>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Choose another state above to broaden the list.</p>
                    </div>} />
                </List>
            </div>
        </main>
    )
}

function WorkItemDetail({ data }: { data: Extract<NativeLibrarySnapshot, { kind: "work-item-detail" }> }) {
    const { item, isAdminItem, assets, role } = data
    return (
        <main className="min-h-full bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <DetailPageHeader
                            category="Work item"
                            reference={shortId(item.id)}
                            title={item.title}
                            labels={isAdminItem ? <SquarePill>Admin</SquarePill> : null}
                            updated={formatRelativeTime(item.updated_at)}
                        />

                <InlineWorkItemFields {...data.fields} />

                <section className="mt-6 rounded-2xl border border-neutral-800 bg-black p-5">
                    <h2 className="text-lg font-semibold">Assets and updates</h2>
                    <div className="mt-4 divide-y divide-neutral-900 rounded-xl border border-neutral-900">
                        {assets.length ? assets.map((asset) => (
                            <Link key={asset.id} href={assetHref(data.workspaceSlug, asset.id)} className="grid gap-2 px-3 py-3 hover:bg-neutral-900/70 sm:grid-cols-[1fr_120px] sm:items-center">
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

                        {role === "owner" || role === "admin" ? <DetailDangerZone>
                            <DetailDangerAction
                                title="Archive work item"
                                description="Archive will remove this item from active work lists while retaining its schedule, links, updates, and history."
                                control={<DetailDangerButton type="button" disabled>Archive work item</DetailDangerButton>}
                            />
                            <DetailDangerAction
                                title="Delete work item permanently"
                                description="Permanent deletion will be enabled after archive storage and dependency safeguards are implemented."
                                control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>}
                            />
                        </DetailDangerZone> : null}
                    </div>
                    {data.context ? <aside data-native-context-spacer aria-hidden="true" className="hidden w-80 shrink-0 lg:block" /> : null}
                </div>
            </div>
        </main>
    )
}

export default function NativeLibraryPanel({ data }: { data: NativeLibrarySnapshot }) {
    switch (data.kind) {
        case "assets": return <Assets data={data} />
        case "asset-detail": return <AssetDetail data={data} />
        case "work-items": return <WorkItems data={data} />
        case "work-item-detail": return <WorkItemDetail data={data} />
    }
}
