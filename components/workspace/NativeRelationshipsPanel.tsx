"use client"

import Link from "@/components/workspace/WorkspaceLink"
import { archiveRelationshipForNativePanel } from "@/app/[workspaceSlug]/relationships/actions"
import { ArchiveRelationshipForm } from "@/app/[workspaceSlug]/relationships/[relationshipId]/ArchiveRelationshipForm"
import { RelationshipServicesWorkspace } from "@/components/relationships/RelationshipServicesWorkspace"
import { RelationshipBackgroundEditor } from "@/components/relationships/RelationshipBackgroundEditor"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, DetailPageHeader } from "@/components/detail"
import { ListActionMenu, type ListAction } from "@/components/list/ListActionMenu"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { MobileAssignedServices } from "@/components/list/MobileAssignedServices"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { RetentionCommunicationsSetup } from "@/components/relationships/RetentionCommunicationsSetup"
import { RoundPill, SquarePill, Status } from "@/components/ui"
import { SERVICE_STAGES } from "@/lib/service-stages"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import type { NativeRelationshipsSnapshot } from "@/lib/workspace-native-relationships"
import { useSearchParams } from "./WorkspaceNavigation"

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
        <PanelTabHeader title="Relationships" description="People, businesses and the services you deliver together." actions={<Link href={`${href}?create=relationship`} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3">New relationship</Link>} />
        <FilterRail ariaLabel="Filter relationships by service stage">
            <FilterRailLink href={href} selected={!selected} instant={{ param: "serviceStage", value: null }}>All <FilterRailCount>{data.rows.length}</FilterRailCount></FilterRailLink>
            {SERVICE_STAGES.map((phase) => <FilterRailLink key={phase.key} href={`${href}?serviceStage=${phase.key}`} selected={selected === phase.key} instant={{ param: "serviceStage", value: phase.key }}>{phase.label} <FilterRailCount>{data.rows.filter((row) => row.serviceStages.includes(phase.key)).length}</FilterRailCount></FilterRailLink>)}
        </FilterRail>
        <List ariaLabel="Relationships">{rows.length ? rows.map((row) => <RelationshipRow key={row.id} row={row} slug={data.workspaceSlug} />) : <div className="p-6"><p className="text-lg font-semibold">No relationships match this service stage.</p><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Choose another service stage above to broaden the list.</p></div>}</List>
    </div></main>
}

function RelationshipDetail({ data }: { data: DetailSnapshot }) {
    const record = data.record
    return <main className="min-h-full bg-neutral-950 px-4 py-6 text-white sm:px-6"><div className="mx-auto max-w-[92rem]"><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0">
        <DetailPageHeader category="Relationship" reference={shortId(record.id)} title={record.name} subtitle={record.businessName ?? "No company saved"} labels={<>{record.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}</>} updated={formatRelativeTime(record.updatedAt)} />
        {data.setup ? <RetentionCommunicationsSetup {...data.setup} workspaceSlug={data.workspaceSlug} relationshipId={record.id} /> : null}
        <RelationshipServicesWorkspace key={`${data.userId}:${record.id}:services`} workspaceSlug={data.workspaceSlug} relationshipId={record.id} userId={data.userId} initial={data.services} canAdd={data.canAdd} canImport={data.canImport} canSeeHistory={data.canSeeHistory} legacy={data.legacy} />
        <RelationshipBackgroundEditor key={`${data.userId}:${record.id}:background`} workspaceSlug={data.workspaceSlug} relationshipId={record.id} userId={data.userId} initial={data.background} updatedAt={record.updatedAt} canEdit={data.canEdit} commandsEnabled={data.backgroundCommandsEnabled} />
        {data.canArchive ? <DetailDangerZone>
            <DetailDangerAction title="Archive relationship" description="Removes it from active relationship lists and WhatsApp confirmation matching while preserving its billing records, messages, and other history." control={<ArchiveRelationshipForm action={archiveRelationshipForNativePanel.bind(null, data.workspaceSlug, record.id)} relationshipName={record.businessName ?? record.name} />} />
            <DetailDangerAction title="Delete relationship permanently" description="Permanent deletion will be enabled after the shared archive lifecycle and dependent-record safeguards are implemented." control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>} />
        </DetailDangerZone> : null}
    </div><aside data-native-context-spacer aria-hidden="true" className="hidden w-80 shrink-0 lg:block" /></div></div></main>
}

export default function NativeRelationshipsPanel({ data }: { data: NativeRelationshipsSnapshot }) {
    return data.kind === "relationships" ? <RelationshipList data={data} /> : <RelationshipDetail data={data} />
}
