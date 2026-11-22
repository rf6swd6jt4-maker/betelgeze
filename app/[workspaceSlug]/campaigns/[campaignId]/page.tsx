import { notFound } from "next/navigation"
import Link from "@/components/workspace/WorkspaceLink"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { PanelTabs } from "@/components/panel/PanelTabs"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeading, TableRow } from "@/components/list/Table"
import { Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { CampaignStageLabel, SourceTag, TestLabel, leadName } from "@/components/campaigns/CampaignParts"
import { PipelineBoard } from "@/components/campaigns/PipelineBoard"
import { AddSourceButton } from "@/components/campaigns/AddSourceButton"
import { CAMPAIGN_STAGES, campaignSourceStatusLabels, campaignStageLabels, formatAppointment, formatMoney } from "@/lib/campaigns/model"
import { CAMPAIGN_LEAD_LIMIT, loadCampaign, loadCampaignLeads, requireCampaigns, type CampaignBookingRow, type CampaignLeadRow, type CampaignSourceRow } from "@/lib/campaigns/server"
import { formatRelativeTime } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

const TABS = ["pipeline", "leads", "sources", "flows"] as const
type Tab = (typeof TABS)[number]
const descriptions: Record<Tab, string> = {
    pipeline: "Every qualified form lands in Not booked with its source's tag. Booking moves it to Booked.",
    leads: "This campaign's leads, newest first. Open one for their answers, appointment and activity.",
    sources: "The landing pages that send leads here. Each has its tag, its booking page and any payment.",
    flows: "Automatic texts for this campaign's leads.",
}
const sourceTone = { live: "green", testing: "yellow", off: "grey" } as const

function cardLine(lead: CampaignLeadRow, booking: CampaignBookingRow | undefined, source: CampaignSourceRow | undefined) {
    const zone = source?.time_zone ?? "America/Chicago"
    if (booking?.status === "booked") return formatAppointment(booking.starts_at, zone)
    if (booking?.status === "held") return `${formatAppointment(booking.starts_at, zone)} held`
    return `${formatRelativeTime(lead.last_submitted_at)} ago`
}

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string; campaignId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const [{ workspaceSlug, campaignId }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const tab: Tab = (TABS as readonly string[]).includes(String(query.tab)) ? query.tab as Tab : "pipeline"
    const [loaded, leadData] = await Promise.all([loadCampaign(workspace.id, campaignId), tab === "pipeline" || tab === "leads" ? loadCampaignLeads(workspace.id, campaignId) : Promise.resolve(null)])
    if (!loaded) notFound()
    const { campaign, sources } = loaded
    const base = `/${workspace.slug}/campaigns/${campaign.id}`
    const sourceById = new Map(sources.map(source => [source.id, source]))
    const sourceFilter = typeof query.source === "string" && sourceById.has(query.source) ? query.source : null
    const leads = leadData?.leads ?? []
    const shown = sourceFilter ? leads.filter(lead => lead.latest_source_id === sourceFilter) : leads
    const tabs = [
        { key: "pipeline", label: "Pipeline", href: base },
        { key: "leads", label: "Leads", href: `${base}?tab=leads` },
        { key: "sources", label: "Sources", href: `${base}?tab=sources` },
        { key: "flows", label: "Text flows", href: `${base}?tab=flows` },
    ]
    const filterRail = <FilterRail ariaLabel="Filter by source">
        <FilterRailLink href={tab === "pipeline" ? base : `${base}?tab=${tab}`} selected={!sourceFilter}>All <FilterRailCount>{leads.length}</FilterRailCount></FilterRailLink>
        {sources.map(source => <FilterRailLink key={source.id} href={`${base}?tab=${tab}&source=${source.id}`} selected={sourceFilter === source.id}>{source.tag} <FilterRailCount>{leads.filter(lead => lead.latest_source_id === source.id).length}</FilterRailCount></FilterRailLink>)}
    </FilterRail>
    const anyPayment = sources.some(source => source.pay_amount_cents !== null) || leads.some(lead => lead.stage === "paid_not_booked")
    const limited = leads.length >= CAMPAIGN_LEAD_LIMIT ? <p className="mt-3 text-xs text-neutral-500">Showing the latest {CAMPAIGN_LEAD_LIMIT} leads.</p> : null

    return <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl">
            <PanelTabHeader title={campaign.name} description={descriptions[tab]}
                actions={tab === "sources" ? <AddSourceButton workspaceSlug={workspace.slug} campaignId={campaign.id} /> : undefined}
                tabs={<PanelTabs items={tabs} active={tab} ariaLabel={`${campaign.name} sections`} />} />

            {tab === "pipeline" ? <>
                {sources.length ? filterRail : null}
                {!sources.length ? <p className="mt-5 text-sm text-neutral-400">No sources yet. Add the landing page your ads send people to in Sources.</p>
                    : <PipelineBoard workspaceSlug={workspace.slug} columns={CAMPAIGN_STAGES.filter(stage => stage !== "paid_not_booked" || anyPayment).map(stage => ({
                        stage, label: campaignStageLabels[stage],
                        cards: shown.filter(lead => lead.stage === stage).map(lead => {
                            const source = lead.latest_source_id ? sourceById.get(lead.latest_source_id) : undefined
                            return { id: lead.id, name: leadName(lead), company: lead.company, href: `${base}/leads/${lead.id}`, tag: source ? { tag: source.tag, tone: source.tag_tone } : null, line: cardLine(lead, leadData?.bookings.get(lead.id), source), test: lead.is_test }
                        }),
                    }))} />}
                {limited}
            </> : null}

            {tab === "leads" ? <>
                {sources.length ? filterRail : null}
                <Table ariaLabel="Leads">
                    <TableHead><TableHeading>Lead</TableHeading><TableHeading>Source</TableHeading><TableHeading>Stage</TableHeading><TableHeading className="max-md:hidden">Appointment</TableHeading><TableHeading numeric className="max-sm:hidden">Came in</TableHeading></TableHead>
                    <TableBody>
                        {shown.length ? shown.map(lead => {
                            const source = lead.latest_source_id ? sourceById.get(lead.latest_source_id) : undefined
                            const booking = leadData?.bookings.get(lead.id)
                            return <TableRow key={lead.id}>
                                <TableCell primary><span className="inline-flex items-center gap-2"><Link data-table-open href={`${base}/leads/${lead.id}`} className="hover:underline">{leadName(lead)}</Link>{lead.company ? <span className="font-normal text-neutral-500 max-sm:hidden">{lead.company}</span> : null}{lead.is_test ? <TestLabel /> : null}</span></TableCell>
                                <TableCell><SourceTag source={source} /></TableCell>
                                <TableCell><CampaignStageLabel stage={lead.stage} /></TableCell>
                                <TableCell className="max-md:hidden">{booking && (booking.status === "booked" || booking.status === "held") ? `${formatAppointment(booking.starts_at, source?.time_zone ?? "America/Chicago")}${booking.status === "held" ? " (held)" : ""}` : <span className="text-neutral-600">–</span>}</TableCell>
                                <TableCell numeric className="max-sm:hidden">{formatRelativeTime(lead.last_submitted_at)} ago</TableCell>
                            </TableRow>
                        }) : <TableEmpty columns={5}>{leads.length ? "No leads from this source yet." : "No leads yet. They appear here as soon as a source sends one."}</TableEmpty>}
                    </TableBody>
                </Table>
                {limited}
            </> : null}

            {tab === "sources" ? <Table ariaLabel="Sources">
                <TableHead><TableHeading>Source</TableHeading><TableHeading>Tag</TableHeading><TableHeading className="max-md:hidden">After the form</TableHeading><TableHeading>Status</TableHeading></TableHead>
                <TableBody>
                    {sources.length ? sources.map(source => <TableRow key={source.id}>
                        <TableCell primary><span className="inline-flex items-center gap-2"><Link data-table-open href={`${base}/sources/${source.id}`} className="hover:underline">{source.name}</Link><span className="font-normal text-neutral-500 max-sm:hidden">{source.page_url ? source.page_url.replace(/^https:\/\//, "") : "No page address yet"}</span></span></TableCell>
                        <TableCell><SourceTag source={source} /></TableCell>
                        <TableCell className="max-md:hidden">{!source.books ? "Collects leads" : source.pay_amount_cents !== null ? `Collects and books, ${formatMoney(source.pay_amount_cents)} to confirm` : "Collects and books"}</TableCell>
                        <TableCell><Status label={campaignSourceStatusLabels[source.status]} tone={sourceTone[source.status]} /></TableCell>
                    </TableRow>) : <TableEmpty columns={4}>No sources yet. Add the landing page your ads send people to.</TableEmpty>}
                </TableBody>
            </Table> : null}

            {tab === "flows" ? <p className="mt-5 max-w-2xl text-sm leading-6 text-neutral-400">Text flows arrive with the SignalHouse connection: instant replies, payment and booking reminders, and no-show follow-ups for these leads. Until then nothing is texted automatically.</p> : null}
        </div>
    </main>
}
