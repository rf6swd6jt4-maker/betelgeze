"use client"

import { archiveRelationshipForNativePanel } from "@/app/[workspaceSlug]/relationships/actions"
import { ArchiveRelationshipForm } from "@/app/[workspaceSlug]/relationships/[relationshipId]/ArchiveRelationshipForm"
import { RelationshipServicesWorkspace } from "@/components/relationships/RelationshipServicesWorkspace"
import { RecordAttachments } from "@/components/detail/RecordAttachments"
import { RelationshipLinks } from "@/components/relationships/RelationshipLinks"
import { RelationshipBackgroundEditor } from "@/components/relationships/RelationshipBackgroundEditor"
import { RelationshipEngagement } from "@/components/relationships/RelationshipEngagement"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, DetailPageHeader, SectionHeading } from "@/components/detail"
import { ListActionMenu, type ListAction } from "@/components/list/ListActionMenu"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeading, TableRow } from "@/components/list/Table"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { MobileAssignedServices } from "@/components/list/MobileAssignedServices"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { RelationshipValues } from "@/components/relationships/RelationshipValues"
import { Assignee, Button, RelationshipStage, RoundPill, SquarePill, Status } from "@/components/ui"
import { ClientPageHeader } from "@/components/relationships/ClientPageHeader"
import { ClientSummary } from "@/components/relationships/ClientSummary"
import Link from "./WorkspaceLink"
import { clientPageTabs } from "@/lib/client-page"
import { clientInitials } from "@/lib/client-rail"
import { serializeWorkspaceDetailPreview } from "@/lib/workspace-detail-preview"
import { RELATIONSHIP_PHASES, type RelationshipPhase } from "@/lib/relationship-phases"
import { SERVICE_STAGES } from "@/lib/service-stages"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import type { NativeRelationshipsSnapshot } from "@/lib/workspace-native-relationships"
import { useSearchParams, useWorkspaceNavigation } from "./WorkspaceNavigation"
import { useEffect } from "react"
import { useTodayLayout } from "./TodayLayout"

type ListSnapshot = Extract<NativeRelationshipsSnapshot, { kind: "relationships" }>
type DetailSnapshot = Extract<NativeRelationshipsSnapshot, { kind: "relationship-detail" }>

function RelationshipRow({ row, slug }: { row: ListSnapshot["rows"][number]; slug: string }) {
    const href = `/${slug}/relationships/${row.id}`
    const title = row.businessName ? `${row.name} – ${row.businessName}` : row.name
    const actions: Array<Partial<ListAction>> = [
        { label: "Open relationship", href }, row.sms ? { label: "Copy phone", copyText: row.sms } : {},
        row.whatsapp ? { label: "Copy WhatsApp", copyText: row.whatsapp } : {}, row.email ? { label: "Copy email", copyText: row.email } : {},
    ]
    return <ListItem detailPreview={{ category: "Relationship", reference: shortId(row.id), title: row.name, subtitle: row.businessName ?? "No company saved", updated: formatRelativeTime(row.updatedAt) }}>
        <MobileListActionSurface actions={actions} label={`Open actions for ${title}`}>
            <ListPrimaryRow>
                <ListTitle href={href} className="flex-1">{title}</ListTitle>
                {row.isTest ? <SquarePill tone="yellow" className="shrink-0">Test</SquarePill> : null}
                <span className="ml-auto shrink-0"><Status label={row.openWork > 0 ? "Open work" : "Up to date"} tone={row.openWork > 0 ? "yellow" : "green"} /></span>
            </ListPrimaryRow>
            <ListSecondaryRow>
                <MobileAssignedServices labels={row.services.map((service) => service.label)} />
                {row.contactRole ? <span className="hidden shrink-0 text-neutral-400 lg:inline">{row.contactRole}</span> : null}
                {row.sms ? <span className="hidden min-w-0 truncate text-neutral-200 sm:inline">SMS: {row.sms}</span> : null}
                {row.whatsapp ? <span className="hidden min-w-0 truncate text-neutral-400 sm:inline">WA: {row.whatsapp}</span> : null}
                {!row.sms && !row.whatsapp ? <span className="hidden min-w-0 truncate text-neutral-500 sm:inline">No phone</span> : null}
                <span className="hidden min-w-0 truncate text-neutral-400 md:inline">{row.email ?? "No email saved"}</span>
                <span className="hidden min-w-0 truncate capitalize text-neutral-500 lg:inline">{row.location ?? "Location unset"}</span>
                <div className="hidden min-w-0 items-center gap-3 overflow-hidden xl:flex">{row.services.map((service) => <RoundPill key={service.key} tone="emerald" className="shrink-0">{service.label}</RoundPill>)}</div>
                {!row.services.length ? <span className="hidden text-neutral-500 sm:inline">No assigned services</span> : null}
                <ListTrailing>
                    <span className="font-mono text-neutral-500">{shortId(row.id)}</span>
                    <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(row.updatedAt)}</span>
                    <ListCreatorBadge src={row.creator?.avatar ?? null} username={row.creator?.username ?? null} label="Added by" date={new Date(row.createdAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} />
                    <ListActionMenu actions={actions} className="hidden sm:block" />
                </ListTrailing>
            </ListSecondaryRow>
        </MobileListActionSurface>
    </ListItem>
}

function RelationshipList({ data }: { data: ListSnapshot }) {
    const search = useSearchParams()
    const requested = search.get("serviceStage")
    const selected = SERVICE_STAGES.some((phase) => phase.key === requested) ? requested : null
    const rows = selected ? data.rows.filter((row) => row.serviceStages.includes(selected as typeof row.serviceStages[number])) : data.rows
    const href = `/${data.workspaceSlug}/relationships`
    return <main className="min-h-full bg-neutral-950 px-4 pb-7 text-white sm:px-6"><div className="mx-auto max-w-7xl">
        <PanelTabHeader title="Relationships" description="People, businesses and the services you deliver together." actions={<Button href={`${href}?create=relationship`}>New relationship</Button>} />
        <FilterRail ariaLabel="Filter relationships by service stage">
            <FilterRailLink href={href} selected={!selected} instant={{ param: "serviceStage", value: null }}>All <FilterRailCount>{data.rows.length}</FilterRailCount></FilterRailLink>
            {SERVICE_STAGES.filter(phase => phase.key !== "for_later").map((phase) => <FilterRailLink key={phase.key} href={`${href}?serviceStage=${phase.key}`} selected={selected === phase.key} instant={{ param: "serviceStage", value: phase.key }}>{phase.label} <FilterRailCount>{data.rows.filter((row) => row.serviceStages.includes(phase.key)).length}</FilterRailCount></FilterRailLink>)}
        </FilterRail>
        <List ariaLabel="Relationships">{rows.length ? rows.map((row) => <RelationshipRow key={row.id} row={row} slug={data.workspaceSlug} />) : <div className="p-6"><p className="text-lg font-semibold">No relationships match this service stage.</p><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Choose another service stage above to broaden the list.</p></div>}</List>
    </div></main>
}

/**
 * Saved views of the Clients table. Each is one question about the same rows, answered from what the list already
 * holds, so choosing one is instant and reads nothing. A service stage is a view too (`stage:<key>`).
 */
const CLIENT_VIEWS: Array<{ key: string; label: string; match: (row: ListSnapshot["rows"][number]) => boolean }> = [
    { key: "open-work", label: "Open work", match: row => row.openWork > 0 },
    { key: "no-manager", label: "No manager", match: row => !row.managed },
    { key: "no-services", label: "No services", match: row => row.serviceCount === 0 },
]

/** Today layout: Relationships as the Clients table (docs/today-layout.md, "Clients"). One line per client. */
function ClientsTable({ data }: { data: ListSnapshot }) {
    const search = useSearchParams()
    const navigation = useWorkspaceNavigation()
    const href = `/${data.workspaceSlug}/relationships`
    const stages = SERVICE_STAGES.filter(phase => phase.key !== "for_later")
    const legacyStage = search.get("serviceStage")
    const requested = search.get("view") ?? (legacyStage ? `stage:${legacyStage}` : null)
    const stageKey = requested?.startsWith("stage:") ? requested.slice(6) : null
    const view = CLIENT_VIEWS.find(entry => entry.key === requested) ?? null
    const stage = stageKey ? stages.find(entry => entry.key === stageKey) ?? null : null
    const selected = view ? view.key : stage ? `stage:${stage.key}` : null
    // An older link names the stage as ?serviceStage=; restate it as a view once, so choosing All really clears it.
    useEffect(() => {
        if (!legacyStage || !navigation) return
        const next = new URLSearchParams(search.toString())
        next.delete("serviceStage")
        if (!next.has("view") && stage) next.set("view", `stage:${stage.key}`)
        navigation.replace(`${href}${next.size ? `?${next}` : ""}`)
    }, [legacyStage, navigation, search, stage, href])
    const rows = view ? data.rows.filter(view.match) : stage ? data.rows.filter(row => row.serviceStages.includes(stage.key)) : data.rows
    return <main className="min-h-full bg-neutral-950 px-4 pb-10 text-white sm:px-7"><div className="mx-auto max-w-[84rem]">
        <PanelTabHeader title="Clients" description="People, businesses and the services you deliver together." actions={<Button href={`${href}?create=relationship`}>New client</Button>} />
        <FilterRail ariaLabel="Client views">
            <FilterRailLink href={href} selected={!selected} instant={{ param: "view", value: null }}>All <FilterRailCount>{data.rows.length}</FilterRailCount></FilterRailLink>
            {CLIENT_VIEWS.map(entry => <FilterRailLink key={entry.key} href={`${href}?view=${entry.key}`} selected={selected === entry.key} instant={{ param: "view", value: entry.key }}>{entry.label} <FilterRailCount>{data.rows.filter(entry.match).length}</FilterRailCount></FilterRailLink>)}
            <span aria-hidden="true" className="mx-1.5 w-px shrink-0 self-stretch bg-[var(--color-card-border)]" />
            {stages.map(entry => <FilterRailLink key={entry.key} href={`${href}?view=stage:${entry.key}`} selected={selected === `stage:${entry.key}`} instant={{ param: "view", value: `stage:${entry.key}` }}>{entry.label} <FilterRailCount>{data.rows.filter(row => row.serviceStages.includes(entry.key)).length}</FilterRailCount></FilterRailLink>)}
        </FilterRail>
        <Table ariaLabel="Clients">
            <TableHead>
                <TableHeading>Client</TableHeading>
                <TableHeading>Stage</TableHeading>
                <TableHeading className="max-md:hidden">Manager</TableHeading>
                <TableHeading className="max-lg:hidden">Services</TableHeading>
                <TableHeading numeric>Open work</TableHeading>
                <TableHeading numeric className="max-sm:hidden">Updated</TableHeading>
            </TableHead>
            <TableBody>
                {rows.length ? rows.map(row => {
                    const phase = RELATIONSHIP_PHASES.some(entry => entry.key === row.phase) ? row.phase as RelationshipPhase : null
                    return <TableRow key={row.id}>
                        <TableCell primary className="w-[52%] max-w-0 sm:w-[34%]">
                            <span className="flex min-w-0 items-center gap-2.5">
                                <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-white/[0.08] text-[10px] font-semibold text-neutral-300">{clientInitials(row.name)}</span>
                                <Link href={`${href}/${row.id}`} prefetch={false} data-table-open data-workspace-detail-preview={serializeWorkspaceDetailPreview({ category: "Relationship", reference: shortId(row.id), title: row.name, subtitle: row.businessName ?? "No company saved", updated: formatRelativeTime(row.updatedAt) })} className="min-w-0 truncate outline-none hover:underline hover:decoration-neutral-600 hover:underline-offset-4 focus-visible:underline">{row.name}</Link>
                                {row.businessName ? <span className="min-w-0 flex-1 truncate font-normal text-neutral-500 max-sm:hidden">{row.businessName}</span> : null}
                                {row.isTest ? <SquarePill tone="yellow" className="shrink-0">Test</SquarePill> : null}
                            </span>
                        </TableCell>
                        <TableCell>{phase ? <RelationshipStage phase={phase} className="text-[13px]!" /> : "—"}</TableCell>
                        <TableCell className="max-md:hidden">{row.manager ? <Assignee name={row.manager.username} avatarSrc={row.manager.avatar} /> : <span className="text-neutral-600">{row.managed ? "Unavailable" : "Unassigned"}</span>}</TableCell>
                        <TableCell className="max-w-0 max-lg:hidden"><span className="block truncate">{row.services.length ? `${row.services[0].label}${row.services.length > 1 ? ` +${row.services.length - 1}` : ""}` : <span className="text-neutral-600">None</span>}</span></TableCell>
                        <TableCell numeric>{row.openWork || <span className="text-neutral-600">–</span>}</TableCell>
                        <TableCell numeric className="max-sm:hidden">{formatRelativeTime(row.updatedAt)}</TableCell>
                    </TableRow>
                }) : <TableEmpty columns={6}>No client matches this view. Choose All to see everyone.</TableEmpty>}
            </TableBody>
        </Table>
    </div></main>
}

/**
 * Today layout: the client's page. Overview and Files and notes are two sections of this one route, so both stay
 * mounted and switching between them reads nothing and keeps drafts. The client's other tabs are their own routes.
 */
function ClientDetail({ data, today }: { data: DetailSnapshot; today: NonNullable<ReturnType<typeof useTodayLayout>> }) {
    const record = data.record
    const section = useSearchParams().get("tab") === "files" ? "files" : "overview"
    const chatTitle = record.businessName?.trim() || record.name
    const tabs = clientPageTabs(data.workspaceSlug, record.id, data.context?.clientTabs ?? data.context?.allowedDestinations ?? ["relationships"])
    const chat = today.chat
    return <main className="min-h-full bg-neutral-950 px-4 pb-10 pt-5 text-white sm:px-7"><div className="@container mx-auto max-w-[84rem]">
        <ClientPageHeader name={record.name} business={record.businessName} phase={record.phase} isTest={record.isTest} tabs={tabs} active={section}
            onChat={chat ? () => chat({ id: record.id, title: chatTitle }) : undefined}
            chatHref={`/${encodeURIComponent(data.workspaceSlug)}/communications?mode=clients&conversation=${encodeURIComponent(record.id)}`} />
        <div hidden={section !== "overview"} data-client-section="overview" className="grid gap-x-10 gap-y-6 pt-5 @4xl:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="order-last min-w-0 @4xl:order-none">
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-neutral-200"><RelationshipValues values={data.services.values} showAllTime={data.canImport} workspaceSlug={data.workspaceSlug} relationshipId={record.id} userId={data.userId} /></div>
                <RelationshipBackgroundEditor key={`${data.userId}:${record.id}:background`} workspaceSlug={data.workspaceSlug} relationshipId={record.id} userId={data.userId} initial={data.background} updatedAt={record.updatedAt} canEdit={data.canEdit} commandsEnabled={data.backgroundCommandsEnabled}>
                    <RelationshipServicesWorkspace key={`${data.userId}:${record.id}:services`} workspaceSlug={data.workspaceSlug} relationshipId={record.id} userId={data.userId} initial={data.services} canAdd={data.canAdd} canImport={data.canImport} canSeeHistory={data.canSeeHistory} legacy={data.legacy} />
                    <RelationshipEngagement key={`${data.userId}:${record.id}:engagement`} workspaceSlug={data.workspaceSlug} relationshipId={record.id} userId={data.userId} />
                    {data.canArchive ? <RelationshipLinks key={`${data.userId}:${record.id}:links`} workspaceSlug={data.workspaceSlug} relationshipId={record.id} userId={data.userId} /> : null}
                </RelationshipBackgroundEditor>
                {data.canArchive ? <DetailDangerZone>
                    <DetailDangerAction title="Archive client" description="Removes them from active client lists and WhatsApp confirmation matching while preserving billing records, messages, and other history." control={<ArchiveRelationshipForm action={archiveRelationshipForNativePanel.bind(null, data.workspaceSlug, record.id)} relationshipName={record.businessName ?? record.name} />} />
                    <DetailDangerAction title="Delete client permanently" description="Permanent deletion will be enabled after the shared archive lifecycle and dependent-record safeguards are implemented." control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>} />
                </DetailDangerZone> : null}
            </div>
            {data.context ? <aside className="min-w-0">
                <SectionHeading>Details</SectionHeading>
                <ClientSummary context={data.context} />
            </aside> : null}
        </div>
        <div hidden={section !== "files"} data-client-section="files" className="pt-1">
            <RecordAttachments key={`${data.userId}:${record.id}:attachments`} workspaceSlug={data.workspaceSlug} userId={data.userId} owner="relationship" ownerId={record.id} canEdit={data.canArchive} />
        </div>
    </div></main>
}

function RelationshipDetail({ data }: { data: DetailSnapshot }) {
    const record = data.record
    return <main className="min-h-full bg-neutral-950 px-4 py-6 text-white sm:px-6"><div className="mx-auto max-w-[92rem]"><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0">
        <DetailPageHeader category="Relationship" reference={shortId(record.id)} title={record.name} subtitle={record.businessName ?? "No company saved"} labels={record.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null} updated={formatRelativeTime(record.updatedAt)} summary={<RelationshipValues values={data.services.values} showAllTime={data.canImport} workspaceSlug={data.workspaceSlug} relationshipId={record.id} userId={data.userId} />} />
        <RelationshipBackgroundEditor key={`${data.userId}:${record.id}:background`} workspaceSlug={data.workspaceSlug} relationshipId={record.id} userId={data.userId} initial={data.background} updatedAt={record.updatedAt} canEdit={data.canEdit} commandsEnabled={data.backgroundCommandsEnabled}>
        <RelationshipServicesWorkspace key={`${data.userId}:${record.id}:services`} workspaceSlug={data.workspaceSlug} relationshipId={record.id} userId={data.userId} initial={data.services} canAdd={data.canAdd} canImport={data.canImport} canSeeHistory={data.canSeeHistory} legacy={data.legacy} />
        <RelationshipEngagement key={`${data.userId}:${record.id}:engagement`} workspaceSlug={data.workspaceSlug} relationshipId={record.id} userId={data.userId} />
        {data.canArchive ? <RelationshipLinks key={`${data.userId}:${record.id}:links`} workspaceSlug={data.workspaceSlug} relationshipId={record.id} userId={data.userId} /> : null}
        <RecordAttachments key={`${data.userId}:${record.id}:attachments`} workspaceSlug={data.workspaceSlug} userId={data.userId} owner="relationship" ownerId={record.id} canEdit={data.canArchive} />
        </RelationshipBackgroundEditor>
        {data.canArchive ? <DetailDangerZone>
            <DetailDangerAction title="Archive relationship" description="Removes it from active relationship lists and WhatsApp confirmation matching while preserving its billing records, messages, and other history." control={<ArchiveRelationshipForm action={archiveRelationshipForNativePanel.bind(null, data.workspaceSlug, record.id)} relationshipName={record.businessName ?? record.name} />} />
            <DetailDangerAction title="Delete relationship permanently" description="Permanent deletion will be enabled after the shared archive lifecycle and dependent-record safeguards are implemented." control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>} />
        </DetailDangerZone> : null}
    </div><aside data-native-context-spacer aria-hidden="true" className="hidden w-80 shrink-0 lg:block" /></div></div></main>
}

export default function NativeRelationshipsPanel({ data }: { data: NativeRelationshipsSnapshot }) {
    // The Today layout has its own forms of both pages; the tabbed layout keeps the list and the record page.
    const today = useTodayLayout()
    if (data.kind === "relationships") return today ? <ClientsTable data={data} /> : <RelationshipList data={data} />
    return today ? <ClientDetail data={data} today={today} /> : <RelationshipDetail data={data} />
}
