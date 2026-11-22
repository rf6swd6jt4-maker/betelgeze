import { notFound } from "next/navigation"
import Link from "@/components/workspace/WorkspaceLink"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeading, TableRow } from "@/components/list/Table"
import { RoundPill, Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { CampaignStageLabel, SourceTag, TestLabel, leadName } from "@/components/campaigns/CampaignParts"
import { PipelineBoard } from "@/components/campaigns/PipelineBoard"
import { AddSourceButton } from "@/components/campaigns/AddSourceButton"
import { CampaignPageHeader } from "@/components/campaigns/CampaignPageHeader"
import { CampaignStatusButton } from "@/components/campaigns/CampaignStatusButton"
import { CAMPAIGN_STAGES, campaignSourceStatusLabels, campaignStageLabels, formatAppointment, formatMoney, formatShortAppointment } from "@/lib/campaigns/model"
import { CAMPAIGN_LEAD_LIMIT, loadCampaign, loadCampaignLeads, loadNotBookedCount, requireCampaigns, type CampaignBookingRow, type CampaignLeadRow, type CampaignSourceRow } from "@/lib/campaigns/server"
import { formatRelativeTime } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

const TABS = ["pipeline", "leads", "sources", "flows"] as const
type Tab = (typeof TABS)[number]
const sourceTone = { live: "green", testing: "yellow", off: "grey" } as const

function cardLine(lead: CampaignLeadRow, booking: CampaignBookingRow | undefined, source: CampaignSourceRow | undefined) {
    const zone = source?.time_zone ?? "America/Chicago"
    if (booking?.status === "booked") return formatShortAppointment(booking.starts_at, zone)
    if (booking?.status === "held") return `${formatShortAppointment(booking.starts_at, zone)} · held`
    return `${formatRelativeTime(lead.last_submitted_at)} ago`
}

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string; campaignId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const [{ workspaceSlug, campaignId }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const tab: Tab = (TABS as readonly string[]).includes(String(query.tab)) ? query.tab as Tab : "pipeline"
    const [loaded, leadData, notBooked] = await Promise.all([loadCampaign(workspace.id, campaignId), tab === "pipeline" || tab === "leads" ? loadCampaignLeads(workspace.id, campaignId) : Promise.resolve(null), loadNotBookedCount(workspace.id, campaignId)])
    if (!loaded) notFound()
    const { campaign, sources } = loaded
    const base = `/${workspace.slug}/campaigns/${campaign.id}`
    const sourceById = new Map(sources.map(source => [source.id, source]))
    const sourceFilter = typeof query.source === "string" && sourceById.has(query.source) ? query.source : null
    const leads = leadData?.leads ?? []
    const shown = sourceFilter ? leads.filter(lead => lead.latest_source_id === sourceFilter) : leads
    const tabs = [
        { key: "pipeline", label: "Pipeline", href: base },
        { key: "leads", label: "Leads", href: `${base}?tab=leads`, count: leadData ? leads.length : undefined },
        { key: "sources", label: "Sources", href: `${base}?tab=sources`, count: sources.length },
        { key: "flows", label: "Text flows", href: `${base}?tab=flows` },
    ]
    const filterRail = <FilterRail ariaLabel="Filter by source">
        <FilterRailLink href={tab === "pipeline" ? base : `${base}?tab=${tab}`} selected={!sourceFilter}>All <FilterRailCount>{leads.length}</FilterRailCount></FilterRailLink>
        {sources.map(source => <FilterRailLink key={source.id} href={`${base}?tab=${tab}&source=${source.id}`} selected={sourceFilter === source.id}><RoundPill tone={source.tag_tone}>{source.tag}</RoundPill> <FilterRailCount>{leads.filter(lead => lead.latest_source_id === source.id).length}</FilterRailCount></FilterRailLink>)}
    </FilterRail>
    // Paid, not booked only happens when a payment arrives after the held time was taken, so its column shows only when used.
    const anyPayment = leads.some(lead => lead.stage === "paid_not_booked")
    const limited = leads.length >= CAMPAIGN_LEAD_LIMIT ? <p className="mt-3 text-xs text-neutral-500">Showing the latest {CAMPAIGN_LEAD_LIMIT} leads.</p> : null

    return <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl">
            <CampaignPageHeader name={campaign.name} status={campaign.status} notBooked={notBooked} tabs={tabs} active={tab}
                tags={sources.filter(source => source.status !== "off").map(source => ({ tag: source.tag, tone: source.tag_tone }))}
                actions={<>
                    <CampaignStatusButton workspaceSlug={workspace.slug} campaignId={campaign.id} status={campaign.status} />
                    {tab === "sources" ? <AddSourceButton workspaceSlug={workspace.slug} campaignId={campaign.id} /> : null}
                </>} />

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
                <Table ariaLabel="Leads" className="max-sm:[&_thead]:hidden max-sm:[&_tbody]:border-t max-sm:[&_tbody]:border-card-border">
                    <TableHead><TableHeading>Lead</TableHeading><TableHeading className="max-sm:hidden">Source</TableHeading><TableHeading>Stage</TableHeading><TableHeading className="max-md:hidden">Appointment</TableHeading><TableHeading numeric className="max-sm:hidden">Came in</TableHeading></TableHead>
                    <TableBody>
                        {shown.length ? shown.map(lead => {
                            const source = lead.latest_source_id ? sourceById.get(lead.latest_source_id) : undefined
                            const booking = leadData?.bookings.get(lead.id)
                            return <TableRow key={lead.id}>
                                <TableCell primary className="w-full max-w-0 max-sm:h-14 sm:w-[34%]">
                                    <span className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-2.5">
                                        <span className="flex min-w-0 items-center gap-2"><Link data-table-open href={`${base}/leads/${lead.id}`} prefetch={false} className="min-w-0 truncate text-sm hover:underline sm:text-[13px]">{leadName(lead)}</Link>{lead.is_test ? <TestLabel /> : null}</span>
                                        {lead.company ? <span className="min-w-0 truncate font-normal text-neutral-500 max-sm:hidden">{lead.company}</span> : null}
                                        {/* Phone: the second line carries the business and the source. */}
                                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-normal text-neutral-500 sm:hidden">{source ? <SourceTag source={source} /> : null}<span className="min-w-0 truncate">{lead.company ?? ""}</span></span>
                                    </span>
                                </TableCell>
                                <TableCell className="max-sm:hidden"><SourceTag source={source} /></TableCell>
                                <TableCell><CampaignStageLabel stage={lead.stage} className="text-[13px]!" /></TableCell>
                                <TableCell className="max-md:hidden">{booking && (booking.status === "booked" || booking.status === "held") ? `${formatAppointment(booking.starts_at, source?.time_zone ?? "America/Chicago")}${booking.status === "held" ? " (held)" : ""}` : <span className="text-neutral-600">–</span>}</TableCell>
                                <TableCell numeric className="max-sm:hidden">{formatRelativeTime(lead.last_submitted_at)} ago</TableCell>
                            </TableRow>
                        }) : <TableEmpty columns={5}>{leads.length ? "No leads from this source yet." : "No leads yet. They appear here as soon as a source sends one."}</TableEmpty>}
                    </TableBody>
                </Table>
                {limited}
            </> : null}

            {tab === "sources" ? <Table ariaLabel="Sources" className="max-sm:[&_thead]:hidden max-sm:[&_tbody]:border-t max-sm:[&_tbody]:border-card-border">
                <TableHead><TableHeading>Source</TableHeading><TableHeading className="max-sm:hidden">Tag</TableHeading><TableHeading className="max-md:hidden">After the form</TableHeading><TableHeading>Status</TableHeading></TableHead>
                <TableBody>
                    {sources.length ? sources.map(source => <TableRow key={source.id}>
                        <TableCell primary className="w-full max-w-0 max-sm:h-14 sm:w-[40%]">
                            <span className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-2.5">
                                <Link data-table-open href={`${base}/sources/${source.id}`} prefetch={false} className="min-w-0 truncate text-sm hover:underline sm:text-[13px]">{source.name}</Link>
                                <span className="min-w-0 truncate font-normal text-neutral-500 max-sm:hidden">{source.page_url ? source.page_url.replace(/^https:\/\//, "") : "No page address yet"}</span>
                                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-normal text-neutral-500 sm:hidden"><SourceTag source={source} /><span className="min-w-0 truncate">{source.page_url ? source.page_url.replace(/^https:\/\//, "") : "No page address yet"}</span></span>
                            </span>
                        </TableCell>
                        <TableCell className="max-sm:hidden"><SourceTag source={source} /></TableCell>
                        <TableCell className="max-md:hidden">{!source.books ? "Collects leads" : source.pay_amount_cents !== null ? `Collects and books, ${formatMoney(source.pay_amount_cents)} to confirm` : "Collects and books"}</TableCell>
                        <TableCell><Status label={campaignSourceStatusLabels[source.status]} tone={sourceTone[source.status]} /></TableCell>
                    </TableRow>) : <TableEmpty columns={4}>No sources yet. Add the landing page your ads send people to.</TableEmpty>}
                </TableBody>
            </Table> : null}

            {tab === "flows" ? <p className="mt-5 max-w-2xl text-sm leading-6 text-neutral-400">Text flows arrive with the SignalHouse connection: instant replies, payment and booking reminders, and no-show follow-ups for these leads. Until then nothing is texted automatically.</p> : null}
        </div>
    </main>
}
