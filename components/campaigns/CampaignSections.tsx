"use client"

import { useCallback, useLayoutEffect, useTransition, type MouseEvent, type ReactNode } from "react"
import Link from "@/components/workspace/WorkspaceLink"
import { useRouter, useSearchParams, useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeading, TableRow } from "@/components/list/Table"
import { Button, RoundPill, SquarePill } from "@/components/ui"
import { CampaignPageHeader } from "@/components/campaigns/CampaignPageHeader"
import { PipelineBoard, type PipelineCard } from "@/components/campaigns/PipelineBoard"
import { CampaignStageLabel, TestLabel } from "@/components/campaigns/CampaignParts"
import { CampaignLeadsPlaceholder } from "@/components/campaigns/CampaignLoading"
import { LeadChatButton } from "@/components/campaigns/LeadChatButton"
import { CAMPAIGN_STAGES, campaignStageLabels, type CampaignStage, type CampaignTagTone } from "@/lib/campaigns/model"

export const CAMPAIGN_TABS = ["pipeline", "leads", "sources", "flows"] as const
export type CampaignTab = (typeof CAMPAIGN_TABS)[number]

/** One lead as the pipeline and the leads list show it, with its times already written out by the server. */
export type CampaignLeadView = PipelineCard & { sourceId: string | null; stage: CampaignStage; appointment: string | null; cameIn: string }
type SourceChip = { id: string; tag: string; tone: CampaignTagTone }

const filtersLeads = (tab: CampaignTab) => tab === "pipeline" || tab === "leads"

/** A section's shareable address: the campaign, its tab, and the source filter where that tab has one. */
export function campaignSectionHref(base: string, tab: CampaignTab, source: string | null) {
    const params = new URLSearchParams()
    if (tab !== "pipeline") params.set("tab", tab)
    if (source && filtersLeads(tab)) params.set("source", source)
    const query = params.toString()
    return query ? `${base}?${query}` : base
}

/**
 * A campaign's sections. They are read with the page, so the tabs and the source filter switch in place
 * (docs/ui-standards.md, "Client page"): the address changes and can be shared, and the header never reloads. A page
 * opened on Sources or Text flows has not read its leads (`leads` is null); Pipeline or Leads reads them once, in the
 * background, under a placeholder for that section only.
 */
export function CampaignSections({ workspaceSlug, base, header, actions, sourceActions, sources, leads, limit, sourcesTable, flows }: {
    workspaceSlug: string; base: string
    header: { name: string; status: string; notBooked: number; tags: { tag: string; tone: CampaignTagTone }[] }
    actions: ReactNode; sourceActions: ReactNode
    sources: SourceChip[]; leads: CampaignLeadView[] | null; limit: number | null
    sourcesTable: ReactNode; flows: ReactNode
}) {
    const navigation = useWorkspaceNavigation()
    const router = useRouter()
    const [reading, startRead] = useTransition()
    const searchParams = useSearchParams()
    const requestedTab = searchParams.get("tab") ?? ""
    const tab: CampaignTab = (CAMPAIGN_TABS as readonly string[]).includes(requestedTab) ? requestedTab as CampaignTab : "pipeline"
    const requestedSource = searchParams.get("source")
    const source = requestedSource && sources.some(entry => entry.id === requestedSource) ? requestedSource : null
    const all = leads ?? []
    // Calls due (docs/text-flows.md): leads a flow asked their setter to call.
    const calls = searchParams.get("calls") === "1"
    const shown = (source ? all.filter(lead => lead.sourceId === source) : all).filter(lead => !calls || lead.call)
    const readLeads = useCallback(() => startRead(() => router.refresh()), [router])
    // Pipeline or Leads opened on a page that skipped its leads (or returned to by Back after a refresh elsewhere):
    // read them once the new address has committed, so the server reads that section, and before paint, so the
    // placeholder shows at once with the header already on the new tab.
    const needsLeads = filtersLeads(tab) && leads === null
    useLayoutEffect(() => { if (needsLeads) readLeads() }, [needsLeads, readLeads])

    function select(key: string, event: MouseEvent<HTMLAnchorElement>) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        const next = key as CampaignTab
        if (next === tab) return
        if (navigation) navigation.push(campaignSectionHref(base, next, source))
        else {
            // Keep the frame's own parameters (its tab identity); change only the section and its filter.
            const url = new URL(window.location.href)
            url.searchParams.delete("tab")
            url.searchParams.delete("source")
            if (next !== "pipeline") url.searchParams.set("tab", next)
            if (source && filtersLeads(next)) url.searchParams.set("source", source)
            window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`)
        }
    }

    const tabs = [
        { key: "pipeline", label: "Pipeline", href: campaignSectionHref(base, "pipeline", source) },
        { key: "leads", label: "Leads", href: campaignSectionHref(base, "leads", source), count: leads?.length },
        { key: "sources", label: "Sources", href: campaignSectionHref(base, "sources", null), count: sources.length },
        { key: "flows", label: "Text flows", href: campaignSectionHref(base, "flows", null) },
    ]
    const filterRail = sources.length && leads ? <FilterRail ariaLabel="Filter by source">
        <FilterRailLink href={campaignSectionHref(base, tab, null)} selected={!source} instant={{ param: "source", value: null }}>All <FilterRailCount>{all.length}</FilterRailCount></FilterRailLink>
        {sources.map(entry => <FilterRailLink key={entry.id} href={campaignSectionHref(base, tab, entry.id)} selected={source === entry.id} instant={{ param: "source", value: entry.id }}>
            <RoundPill tone={entry.tone}>{entry.tag}</RoundPill> <FilterRailCount>{all.filter(lead => lead.sourceId === entry.id).length}</FilterRailCount>
        </FilterRailLink>)}
        {all.some(lead => lead.call) || calls ? <>
            <span aria-hidden="true" className="mx-1 h-4 w-px self-center bg-[var(--color-card-border)]" />
            <FilterRailLink href={`${campaignSectionHref(base, tab, source)}${campaignSectionHref(base, tab, source).includes("?") ? "&" : "?"}calls=1`} selected={calls} instant={{ param: "calls", value: calls ? null : "1" }}>
                Calls due <FilterRailCount>{all.filter(lead => lead.call && (!source || lead.sourceId === source)).length}</FilterRailCount>
            </FilterRailLink>
        </> : null}
    </FilterRail> : null
    // Paid, not booked only happens when a payment arrives after the held time was taken, so its column shows only when used.
    const anyPayment = all.some(lead => lead.stage === "paid_not_booked")
    const limited = limit ? <p className="mt-3 text-xs text-neutral-500">Showing the latest {limit} leads.</p> : null

    // Leads not read yet: the placeholder while they are read, or a way to read them again after a failed read.
    const unread = reading ? <div role="status" aria-label="Loading leads"><CampaignLeadsPlaceholder /></div>
        : <div className="mt-5 flex items-center gap-3 text-sm text-neutral-400">Leads are not shown yet.<Button size="sm" variant="secondary" onClick={readLeads}>Show leads</Button></div>

    return <>
        <CampaignPageHeader name={header.name} status={header.status} notBooked={header.notBooked} tags={header.tags} tabs={tabs} active={tab} onSelect={select}
            actions={<>{actions}{tab === "sources" ? sourceActions : null}</>} />

        {needsLeads ? unread : null}

        {tab === "pipeline" && leads ? <>
            {filterRail}
            {!sources.length ? <p className="mt-5 text-sm text-neutral-400">No sources yet. Add the landing page your ads send people to in Sources.</p>
                : <PipelineBoard workspaceSlug={workspaceSlug} columns={CAMPAIGN_STAGES.filter(stage => stage !== "paid_not_booked" || anyPayment).map(stage => ({
                    stage, label: campaignStageLabels[stage], cards: shown.filter(lead => lead.stage === stage),
                }))} />}
            {limited}
        </> : null}

        {tab === "leads" && leads ? <>
            {filterRail}
            <Table ariaLabel="Leads" className="max-sm:[&_thead]:hidden max-sm:[&_tbody]:border-t max-sm:[&_tbody]:border-card-border">
                <TableHead><TableHeading>Lead</TableHeading><TableHeading className="max-sm:hidden">Source</TableHeading><TableHeading>Stage</TableHeading><TableHeading className="max-md:hidden">Appointment</TableHeading><TableHeading numeric className="max-sm:hidden">Came in</TableHeading><TableHeading className="max-sm:hidden"><span className="sr-only">Chat</span></TableHeading></TableHead>
                <TableBody>
                    {shown.length ? shown.map(lead => {
                        const tag = lead.tag ? <RoundPill tone={lead.tag.tone}>{lead.tag.tag}</RoundPill> : null
                        return <TableRow key={lead.id}>
                            <TableCell primary className="w-full max-w-0 max-sm:h-14 sm:w-[34%]">
                                <span className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-2.5">
                                    <span className="flex min-w-0 items-center gap-2"><Link data-table-open href={lead.href} prefetch={false} className="min-w-0 truncate text-sm hover:underline sm:text-[13px]">{lead.name}</Link>{lead.test ? <TestLabel /> : null}{lead.call ? <SquarePill tone="yellow">Call</SquarePill> : null}</span>
                                    {lead.company ? <span className="min-w-0 truncate font-normal text-neutral-500 max-sm:hidden">{lead.company}</span> : null}
                                    {/* Phone: the second line carries the source and the business. */}
                                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-normal text-neutral-500 sm:hidden">{tag}<span className="min-w-0 truncate">{lead.company ?? ""}</span></span>
                                </span>
                            </TableCell>
                            <TableCell className="max-sm:hidden">{tag ?? <span className="text-neutral-600">No source</span>}</TableCell>
                            <TableCell><CampaignStageLabel stage={lead.stage} className="text-[13px]!" /></TableCell>
                            <TableCell className="max-md:hidden">{lead.appointment ?? <span className="text-neutral-600">–</span>}</TableCell>
                            <TableCell numeric className="max-sm:hidden">{lead.cameIn}</TableCell>
                            <TableCell className="w-px max-sm:hidden"><LeadChatButton workspaceSlug={workspaceSlug} leadId={lead.id} variant="ghost" /></TableCell>
                        </TableRow>
                    }) : <TableEmpty columns={6}>{all.length ? "No leads from this source yet." : "No leads yet. They appear here as soon as a source sends one."}</TableEmpty>}
                </TableBody>
            </Table>
            {limited}
        </> : null}

        {tab === "sources" ? sourcesTable : null}
        {tab === "flows" ? flows : null}
    </>
}
