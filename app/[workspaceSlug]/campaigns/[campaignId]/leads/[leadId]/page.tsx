import { headers } from "next/headers"
import { notFound } from "next/navigation"
import Link from "@/components/workspace/WorkspaceLink"
import { SectionHeading } from "@/components/detail"
import { Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { CampaignStageLabel, SourceTag, TestLabel, eventText, leadName } from "@/components/campaigns/CampaignParts"
import { BookingActions, BookingLinkActions, LeadStageField, MarkSoldButton } from "@/components/campaigns/LeadControls"
import { formatAppointment, formatMoney, meetingPlaceLabels } from "@/lib/campaigns/model"
import { loadCampaign, loadCampaignLead, requireCampaigns } from "@/lib/campaigns/server"
import { clientInitials } from "@/lib/client-rail"
import { formatRelativeTime } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

const formatPhone = (value: string) => value.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "+1 ($1) $2-$3")
const propertyRow = "grid min-h-9 grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-2 py-1.5 text-sm"

/** A lead's page: who they are and where they stand, their appointment and activity, and beside it their details. */
export default async function CampaignLeadPage({ params }: { params: Promise<{ workspaceSlug: string; campaignId: string; leadId: string }> }) {
    const { workspaceSlug, campaignId, leadId } = await params
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const [loaded, record, requestHeaders] = await Promise.all([loadCampaign(workspace.id, campaignId), loadCampaignLead(workspace.id, leadId), headers()])
    if (!loaded || !record || record.lead.latest_campaign_id !== loaded.campaign.id) notFound()
    const { lead, bookings, events, current } = record
    const sourceById = new Map(loaded.sources.map(source => [source.id, source]))
    const source = lead.latest_source_id ? sourceById.get(lead.latest_source_id) : undefined
    const zone = source?.time_zone ?? "America/Chicago"
    const latestDone = bookings.find(booking => booking.status === "showed" || booking.status === "no_show")
    const paid = bookings.filter(booking => booking.paid_at)
    const activity = events.map(event => ({ event, text: eventText(event, zone, id => sourceById.get(id)?.name ?? null) })).filter((entry): entry is typeof entry & { text: string } => Boolean(entry.text))
    const name = leadName(lead)
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "app.betelgeze.com"
    const appOrigin = `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`
    const bookingLink = source?.books && source.booking_slug && source.status !== "off" ? `${appOrigin}/book/${source.booking_slug}?ref=${lead.reference}` : null
    const canBook = !current && !["sold", "lost"].includes(lead.stage)

    return <main className="min-h-screen bg-neutral-950 px-4 pb-10 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="@container mx-auto max-w-6xl pt-5">
            <header data-workspace-record-title={name} className="flex flex-wrap items-center gap-x-3 gap-y-3 border-b border-card-border pb-4">
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-[13px] font-semibold text-neutral-200">{clientInitials(name)}</span>
                <div className="min-w-0 flex-1">
                    <h1 className="truncate text-xl font-semibold tracking-tight text-white">{name}</h1>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-400">
                        <CampaignStageLabel stage={lead.stage} />
                        <SourceTag source={source} />
                        <span className="min-w-0 truncate">{lead.company ?? "No business name given"}</span>
                        {lead.is_test ? <TestLabel /> : null}
                    </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <div className="w-44"><LeadStageField workspaceSlug={workspace.slug} leadId={lead.id} stage={lead.stage} /></div>
                    <MarkSoldButton workspaceSlug={workspace.slug} leadId={lead.id} stage={lead.stage} />
                </div>
            </header>

            <div className="flex flex-col gap-8 pt-5 @4xl:grid @4xl:grid-cols-[minmax(0,1fr)_19rem] @4xl:items-start @4xl:gap-x-10">
                <div className="flex min-w-0 flex-col gap-8">
                    <section aria-label="Appointment">
                        <SectionHeading>Appointment</SectionHeading>
                        {current ? <div className="py-2">
                            <p className="text-xs text-neutral-500">{source?.meeting_title ?? "Call"} · {source?.meeting_minutes ?? 30} min · {meetingPlaceLabels[source?.meeting_place ?? "phone"].split(",")[0]}</p>
                            <p className="mt-1 text-lg font-semibold tracking-tight">{formatAppointment(current.starts_at, zone)}</p>
                            <p className="mt-1 text-sm text-neutral-400">{current.status === "held"
                                ? `Held until ${new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(current.held_until!))} while they pay ${formatMoney(current.amount_cents)}. If they don't, the time is released.`
                                : `${current.booked_by === "staff" ? "Booked by your team" : "Booked on the booking page"}${current.paid_at ? `, paid ${formatMoney(current.amount_cents)}` : ""}.`}</p>
                            <BookingActions workspaceSlug={workspace.slug} bookingId={current.id} status={current.status} />
                        </div> : <div className="py-2">
                            <p className="text-sm text-neutral-400">{latestDone ? `${latestDone.status === "showed" ? "Showed" : "No-show"} for ${formatAppointment(latestDone.starts_at, zone)}.` : lead.stage === "paid_not_booked" ? "Paid, no time booked yet. Their booking link lets them pick one without paying again." : "No time booked yet."}
                                {canBook && source?.pay_amount_cents && lead.stage !== "paid_not_booked" ? ` They pick a time, then pay ${formatMoney(source.pay_amount_cents)} within ${source.hold_minutes} minutes to confirm it.` : ""}</p>
                            {canBook && bookingLink ? <BookingLinkActions href={bookingLink} /> : null}
                        </div>}
                    </section>

                    <section aria-label="Activity">
                        <SectionHeading count={activity.length}>Activity</SectionHeading>
                        <ol>{activity.map(({ event, text }) => <li key={event.id} className="flex items-baseline justify-between gap-4 border-t border-card-border py-2 first:border-t-0">
                            <span className="text-sm text-neutral-300">{text}</span><span className="shrink-0 text-xs tabular-nums text-neutral-500">{formatRelativeTime(event.created_at)} ago</span>
                        </li>)}</ol>
                    </section>
                </div>

                <aside className="flex min-w-0 flex-col gap-8" aria-label="Details">
                    <section aria-label="Contact">
                        <SectionHeading>Contact</SectionHeading>
                        <div className={propertyRow}><span className="text-neutral-500">Phone</span><span className="tabular-nums text-neutral-200">{formatPhone(lead.phone_e164)}</span></div>
                        <div className={propertyRow}><span className="text-neutral-500">Email</span><span className="truncate text-neutral-200">{lead.email ?? <span className="text-neutral-500">None given</span>}</span></div>
                        <div className={propertyRow}><span className="text-neutral-500">Business</span><span className="truncate text-neutral-200">{lead.company ?? <span className="text-neutral-500">None given</span>}</span></div>
                        <div className={propertyRow}><span className="text-neutral-500">Texts</span><Status label={lead.sms_consent === "opted_in" ? "Opted in on the form" : "Opted out"} tone={lead.sms_consent === "opted_in" ? "green" : "grey"} /></div>
                    </section>

                    <section aria-label="Form answers">
                        <SectionHeading>Form answers</SectionHeading>
                        <dl>{lead.answers.map((answer, index) => <div key={`${answer.id ?? index}`} className="border-t border-card-border py-2 first:border-t-0">
                            <dt className="text-xs text-neutral-500">{answer.question ?? answer.id}</dt><dd className="mt-0.5 text-sm text-neutral-200">{answer.answer}</dd>
                        </div>)}</dl>
                    </section>

                    {paid.length || source?.pay_amount_cents ? <section aria-label="Payment">
                        <SectionHeading>Payment</SectionHeading>
                        {paid.length ? paid.map(booking => <div key={booking.id} className={propertyRow}><span className="text-neutral-500">Paid</span><span className="text-neutral-200">{formatMoney(booking.amount_cents)} on Stripe, {formatRelativeTime(booking.paid_at)} ago</span></div>)
                            : <div className={propertyRow}><span className="text-neutral-500">Status</span><Status label="Not paid" tone="grey" /></div>}
                    </section> : null}

                    <section aria-label="Source">
                        <SectionHeading>Source</SectionHeading>
                        <div className={propertyRow}><span className="text-neutral-500">Source</span><span className="flex min-w-0 items-center gap-2">{source ? <Link href={`/${workspace.slug}/campaigns/${loaded.campaign.id}/sources/${source.id}`} className="truncate text-neutral-200 hover:underline">{source.name}</Link> : <span className="text-neutral-500">Unknown</span>}</span></div>
                        <div className={propertyRow}><span className="text-neutral-500">Came in</span><span className="tabular-nums text-neutral-200">{formatRelativeTime(lead.first_submitted_at)} ago</span></div>
                        <div className={propertyRow}><span className="text-neutral-500">Forms sent</span><span className="tabular-nums text-neutral-200">{lead.submission_count}</span></div>
                    </section>
                </aside>
            </div>
        </div>
    </main>
}
