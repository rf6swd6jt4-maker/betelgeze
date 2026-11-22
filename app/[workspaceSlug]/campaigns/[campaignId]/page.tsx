import { notFound } from "next/navigation"
import Link from "@/components/workspace/WorkspaceLink"
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeading, TableRow } from "@/components/list/Table"
import { Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { SourceTag, leadName } from "@/components/campaigns/CampaignParts"
import { AddSourceButton } from "@/components/campaigns/AddSourceButton"
import { CampaignSections, type CampaignLeadView } from "@/components/campaigns/CampaignSections"
import { CampaignStatusButton } from "@/components/campaigns/CampaignStatusButton"
import { campaignSourceStatusLabels, formatAppointment, formatMoney, formatShortAppointment } from "@/lib/campaigns/model"
import { CAMPAIGN_LEAD_LIMIT, loadCampaign, loadCampaignLeads, loadNotBookedCount, requireCampaigns, type CampaignBookingRow, type CampaignLeadRow, type CampaignSourceRow } from "@/lib/campaigns/server"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { TextingNumberField } from "@/components/campaigns/TextingNumberField"
import { loadUsableSmsNumbers } from "@/lib/signalhouse/server"
import { smsNumberName } from "@/lib/signalhouse/model"
import { FlowsTab } from "@/components/campaigns/FlowsTab"
import { loadCampaignFlowList, loadSetters } from "@/lib/campaigns/flows-server"

export const dynamic = "force-dynamic"

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
    // The tabs and the source filter switch in place, without another read. Leads are read for the tabs that show
    // them: a page opened on Sources or Text flows reads them when Pipeline or Leads is first opened.
    const withLeads = query.tab !== "sources" && query.tab !== "flows"
    // Text flows switch in place like the other tabs, so their list (two small indexed reads) loads with the page.
    const [loaded, leadData, notBooked, numbers, flowItems, setters] = await Promise.all([loadCampaign(workspace.id, campaignId), withLeads ? loadCampaignLeads(workspace.id, campaignId) : Promise.resolve(null), loadNotBookedCount(workspace.id, campaignId), loadUsableSmsNumbers(workspace.id), /^[0-9a-f-]{36}$/i.test(campaignId) ? loadCampaignFlowList(workspace.id, campaignId) : Promise.resolve([]), withLeads ? loadSetters(workspace.id) : Promise.resolve([])])
    if (!loaded) notFound()
    const { campaign, sources } = loaded
    const base = `/${workspace.slug}/campaigns/${campaign.id}`
    const sourceById = new Map(sources.map(source => [source.id, source]))
    const setterFirst = new Map(setters.map(setter => [setter.id, setter.name.split(/\s+/)[0]]))
    const leads: CampaignLeadView[] | null = leadData ? leadData.leads.map(lead => {
        const source = lead.latest_source_id ? sourceById.get(lead.latest_source_id) : undefined
        const booking = leadData.bookings.get(lead.id)
        const open = booking && (booking.status === "booked" || booking.status === "held") ? booking : null
        return {
            id: lead.id, name: leadName(lead), company: lead.company, href: `${base}/leads/${lead.id}`, test: lead.is_test,
            tag: source ? { tag: source.tag, tone: source.tag_tone } : null, line: cardLine(lead, booking, source),
            sourceId: source?.id ?? null, stage: lead.stage, call: Boolean(lead.call_due_at), setter: lead.assigned_to ? setterFirst.get(lead.assigned_to) ?? null : null,
            appointment: open ? `${formatAppointment(open.starts_at, source?.time_zone ?? "America/Chicago")}${open.status === "held" ? " (held)" : ""}` : null,
            cameIn: `${formatRelativeTime(lead.last_submitted_at)} ago`,
        }
    }) : null
    const sourcesTable = <Table ariaLabel="Sources" className="max-sm:[&_thead]:hidden max-sm:[&_tbody]:border-t max-sm:[&_tbody]:border-card-border">
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
    </Table>

    return <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl">
            <CampaignSections workspaceSlug={workspace.slug} base={base} leads={leads} limit={leads && leads.length >= CAMPAIGN_LEAD_LIMIT ? CAMPAIGN_LEAD_LIMIT : null}
                header={{ name: campaign.name, status: campaign.status, notBooked, tags: sources.filter(source => source.status !== "off").map(source => ({ tag: source.tag, tone: source.tag_tone })) }}
                sources={sources.map(source => ({ id: source.id, tag: source.tag, tone: source.tag_tone }))}
                actions={<CampaignStatusButton workspaceSlug={workspace.slug} campaignId={campaign.id} status={campaign.status} />}
                sourceActions={<AddSourceButton workspaceSlug={workspace.slug} campaignId={campaign.id} />}
                sourcesTable={sourcesTable}
                flows={<FlowsTab workspaceSlug={workspace.slug} campaignId={campaign.id} base={base} items={flowItems}
                    sources={sources.map(source => ({ id: source.id, tag: source.tag, tone: source.tag_tone, books: source.books, pays: source.pay_amount_cents !== null }))}
                    numberField={<div className="grid gap-1.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
                        <p className="pt-2 text-sm text-neutral-500">Texts from</p>
                        <div className="min-w-0">
                            <TextingNumberField workspaceSlug={workspace.slug} kind="campaign" targetId={campaign.id} value={campaign.sms_number_id ?? null} label="Number this campaign texts from"
                                options={numbers.map(number => ({ id: number.id, name: smsNumberName(number), canSend: number.canSend }))} />
                            <p className="mt-1.5 text-xs leading-5 text-neutral-500">{sources.some(source => source.sms_number_id) ? `${sources.filter(source => source.sms_number_id).map(source => source.name).join(", ")} use${sources.filter(source => source.sms_number_id).length > 1 ? "" : "s"} its own number. ` : ""}A lead keeps the number that first texted them. <Link href={`/${workspace.slug}/settings/signalhouse`} className="text-neutral-300 hover:underline">Numbers</Link></p>
                        </div>
                    </div>} />} />
        </div>
    </main>
}
