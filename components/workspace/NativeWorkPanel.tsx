"use client"

import Link from "@/components/workspace/WorkspaceLink"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { workItemStatusPresentation } from "@/components/list/work-item-presentation"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { InstantFilterResults } from "@/components/panel/InstantFilterResults"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { RelationshipStage, SquarePill, Status } from "@/components/ui"
import { phaseLabel } from "@/lib/relationship-phases"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import type { NativeWorkSnapshot } from "@/lib/workspace-native-work"
import { useSearchParams } from "./WorkspaceNavigation"

function WorkList({ data }: { data: Extract<NativeWorkSnapshot, { kind: "work" }> }) {
    const search = useSearchParams()
    const { items } = data
    const fulfilmentRelationshipIds = new Set(items.map((item) => item.relationship_id).filter(Boolean))
    const blockedItems = items.filter((item) => item.status === "blocked")
    const dueItems = items.filter((item) => item.due_date && new Date(item.due_date) <= new Date())
    const state = search.get("state")
    const selectedState = state === "blocked" || state === "due" ? state : null
    const filterHref = (state: string | null) => `/${data.workspaceSlug}/work${state ? `?state=${state}` : ""}`
    return (
        <main className="min-h-full bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <div className="mx-auto max-w-7xl">
                <PanelTabHeader
                    title="Fulfilment"
                    description="Open fulfilment work shared with its relationship record."
                />

                <QuickStats ariaLabel="Fulfilment statistics" items={[
                    { label: "Open work", value: items.length },
                    { label: "Relationships", value: fulfilmentRelationshipIds.size, hideOnMobile: true },
                    { label: "Blocked", value: blockedItems.length },
                    { label: "Due/ready", value: dueItems.length },
                ]} />

                <FilterRail ariaLabel="Filter fulfilment work">
                    <FilterRailLink href={filterHref(null)} selected={!selectedState} instant={{ param: "state", value: null }}>All work <FilterRailCount>{items.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("blocked")} selected={selectedState === "blocked"} instant={{ param: "state", value: "blocked" }}>Blocked <FilterRailCount>{blockedItems.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("due")} selected={selectedState === "due"} instant={{ param: "state", value: "due" }}>Due/ready <FilterRailCount>{dueItems.length}</FilterRailCount></FilterRailLink>
                </FilterRail>

                <List ariaLabel="Fulfilment work">
                    <InstantFilterResults filters={[{ param: "state" }]} items={items.map((item) => {
                        const href = item.href
                        const status = workItemStatusPresentation(item.status)
                        const date = item.due_date ?? item.planned_start_date ?? item.actual_start_at ?? item.created_at
                        const creator = item.creator
                        const creatorAvatarSrc = creator?.avatar ?? null
                        const relationshipTitle = item.relationship
                            ? item.relationship.business_name
                                ? `${item.relationship.primary_person_name} – ${item.relationship.business_name}`
                                : item.relationship.primary_person_name
                            : "Workspace work"
                        const actions = [{ label: "Open work item", href }]
                        const opensRelationship = href.includes(`/${data.workspaceSlug}/relationships/`)
                        const opensFulfilment = href.includes(`/${data.workspaceSlug}/work/`)
                        const filterStates = [
                            item.status === "blocked" ? "blocked" : null,
                            item.due_date && new Date(item.due_date) <= new Date() ? "due" : null,
                        ].filter((value): value is string => Boolean(value))
                        return { id: item.id, values: { state: filterStates }, content: <ListItem detailPreview={{
                            category: opensFulfilment ? "Fulfilment" : opensRelationship ? "Relationship" : "Work item",
                            reference: shortId(opensFulfilment || opensRelationship ? item.relationship_id ?? item.id : item.id),
                            title: opensFulfilment || opensRelationship ? item.relationship?.primary_person_name ?? item.title : item.title,
                            subtitle: opensFulfilment || opensRelationship ? item.relationship?.business_name ?? "No company saved" : null,
                            updated: formatRelativeTime(item.updated_at),
                        }}>
                            <MobileListActionSurface actions={actions} label={`Open actions for ${item.title}`}>
                                <ListPrimaryRow>
                                    <ListTitle href={href} className="flex-1">{item.title}</ListTitle>
                                    {item.is_key_task ? <span className="hidden shrink-0 sm:inline-flex"><SquarePill>Key task</SquarePill></span> : null}
                                    <Status label={status.label} tone={status.tone} className="ml-auto shrink-0" />
                                </ListPrimaryRow>
                                <ListSecondaryRow>
                                    <span className="min-w-0 flex-1 truncate text-neutral-300">{relationshipTitle}</span>
                                    {item.description ? <span className="hidden min-w-0 truncate text-neutral-500 xl:inline">{item.description}</span> : null}
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
                        <p className="text-lg font-semibold">No fulfilment work matches this state.</p>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Choose another state above to broaden the list.</p>
                    </div>} />
                </List>
            </div>
        </main>
    )
}

function WorkDetail({ data }: { data: Extract<NativeWorkSnapshot, { kind: "work-detail" }> }) {
    const { relationship, role, openItems, openCount } = data
    return (
        <main className="min-h-full bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <DetailPageHeader
                            category="Fulfilment"
                            reference={shortId(relationship.id)}
                            title={relationship.primary_person_name}
                            subtitle={relationship.business_name ?? "No company saved"}
                            labels={relationship.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}
                            updated={formatRelativeTime(relationship.updated_at)}
                        />

                        <DetailFields>
                            <DetailField label="Status" icon="status"><Status label={openCount ? "In progress" : "No open work"} tone={openCount ? "yellow" : "grey"} /></DetailField>
                            <DetailField label="Lifecycle" icon="timeline" className="lg:border-l lg:border-neutral-900 lg:pl-8"><RelationshipStage phase={relationship.lifecycle_phase} /></DetailField>
                            <DetailField label="Open work" icon="activity">{openCount}</DetailField>
                            <DetailField label="Updated" icon="time" className="lg:border-l lg:border-neutral-900 lg:pl-8">{formatRelativeTime(relationship.updated_at)}</DetailField>
                        </DetailFields>

                <section className="mt-6 rounded-2xl border border-neutral-800 bg-black p-5">
                    <h2 className="text-lg font-semibold">Future fulfilment workspace</h2>
                    <p className="mt-2 text-sm leading-6 text-neutral-400">
                        Placeholder for relationship fulfilment tasks, blockers, due dates, assigned work, assets, and links to global work-item detail panels.
                    </p>
                    <div className="mt-4 divide-y divide-neutral-900 rounded-xl border border-neutral-900">
                        {openItems.slice(0, 6).map((item) => (
                            <Link key={item.id} href={item.href} className="block px-3 py-2 hover:bg-neutral-900/70">
                                <p className="text-sm font-medium text-neutral-100">{item.title}</p>
                                <p className="mt-1 text-xs text-neutral-500">{item.status} · {phaseLabel(item.lifecycle_phase)}</p>
                            </Link>
                        ))}
                        {openCount === 0 && (
                            <p className="px-3 py-4 text-sm text-neutral-500">No open work items are attached yet.</p>
                        )}
                    </div>
                    {role !== "staff" ? <Link href={`/${data.workspaceSlug}/relationships/${relationship.id}`} className="mt-4 inline-flex rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:text-white">
                        Open relationship summary
                    </Link> : null}
                </section>

                        {role === "owner" || role === "admin" ? <DetailDangerZone>
                            <DetailDangerAction title="Archive fulfilment" description="Archive will remove this fulfilment workspace from active views while preserving linked work and assets." control={<DetailDangerButton type="button" disabled>Archive fulfilment</DetailDangerButton>} />
                            <DetailDangerAction title="Delete fulfilment permanently" description="Permanent deletion will be enabled when fulfilment has an independent archive lifecycle and dependent-record safeguards." control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>} />
                        </DetailDangerZone> : null}
                    </div>
                    {data.context ? <aside data-native-context-spacer aria-hidden="true" className="hidden w-80 shrink-0 lg:block" /> : null}
                </div>
            </div>
        </main>
    )
}

export default function NativeWorkPanel({ data }: { data: NativeWorkSnapshot }) {
    return data.kind === "work" ? <WorkList data={data} /> : <WorkDetail data={data} />
}
