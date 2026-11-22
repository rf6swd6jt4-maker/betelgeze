import { notFound } from "next/navigation"
import Link from "@/components/workspace/WorkspaceLink"
import { DetailField, DetailFields, DetailPageHeader, SectionHeading } from "@/components/detail"
import { Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { SourceTag, TestLabel, eventText, leadName, shortId } from "@/components/campaigns/CampaignParts"
import { BookingActions, LeadStageField } from "@/components/campaigns/LeadControls"
import { formatAppointment, formatMoney, meetingPlaceLabels } from "@/lib/campaigns/model"
import { loadCampaign, loadCampaignLead, requireCampaigns } from "@/lib/campaigns/server"
import { formatRelativeTime } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

const formatPhone = (value: string) => value.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "+1 ($1) $2-$3")

export default async function CampaignLeadPage({ params }: { params: Promise<{ workspaceSlug: string; campaignId: string; leadId: string }> }) {
    const { workspaceSlug, campaignId, leadId } = await params
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const [loaded, record] = await Promise.all([loadCampaign(workspace.id, campaignId), loadCampaignLead(workspace.id, leadId)])
    if (!loaded || !record || record.lead.latest_campaign_id !== loaded.campaign.id) notFound()
    const { lead, bookings, events, current } = record
    const sourceById = new Map(loaded.sources.map(source => [source.id, source]))
    const source = lead.latest_source_id ? sourceById.get(lead.latest_source_id) : undefined
    const zone = source?.time_zone ?? "America/Chicago"
    const latestDone = bookings.find(booking => booking.status === "showed" || booking.status === "no_show")
    const paid = bookings.filter(booking => booking.paid_at)
    const activity = events.map(event => ({ event, text: eventText(event, zone, id => sourceById.get(id)?.name ?? null) })).filter((entry): entry is typeof entry & { text: string } => Boolean(entry.text))
    const name = leadName(lead)

    return <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-4xl pt-5">
            <DetailPageHeader category="Lead" reference={shortId(lead.id)} title={name} subtitle={lead.company ?? "No business name given"}
                labels={<span className="flex items-center gap-2"><SourceTag source={source} />{lead.is_test ? <TestLabel /> : null}</span>}
                updated={`Came in ${formatRelativeTime(lead.last_submitted_at)} ago`} />

            <DetailFields>
                <DetailField label="Stage" icon="status"><LeadStageField workspaceSlug={workspace.slug} leadId={lead.id} stage={lead.stage} /></DetailField>
                <DetailField label="Source" icon="source" className="lg:border-l lg:border-neutral-900 lg:pl-8">{source ? <Link href={`/${workspace.slug}/campaigns/${loaded.campaign.id}/sources/${source.id}`} className="text-neutral-200 hover:underline">{source.name}</Link> : <span className="text-neutral-500">Unknown</span>}</DetailField>
                <DetailField label="Phone" icon="contact"><span className="tabular-nums text-neutral-200">{formatPhone(lead.phone_e164)}</span></DetailField>
                <DetailField label="Email" icon="contact" className="lg:border-l lg:border-neutral-900 lg:pl-8"><span className="text-neutral-200">{lead.email ?? <span className="text-neutral-500">None given</span>}</span></DetailField>
                <DetailField label="Texts" icon="status"><Status label={lead.sms_consent === "opted_in" ? "Opted in on the form" : "Opted out"} tone={lead.sms_consent === "opted_in" ? "green" : "grey"} /></DetailField>
                <DetailField label="Forms sent" icon="activity" className="lg:border-l lg:border-neutral-900 lg:pl-8"><span className="tabular-nums text-neutral-200">{lead.submission_count}</span></DetailField>
            </DetailFields>

            <SectionHeading className="mt-8">Appointment</SectionHeading>
            {current ? <div className="py-2">
                <p className="text-xs text-neutral-500">{source?.meeting_title ?? "Call"} · {source?.meeting_minutes ?? 30} min · {meetingPlaceLabels[source?.meeting_place ?? "phone"].split(",")[0]}</p>
                <p className="mt-1 text-lg font-semibold tracking-tight">{formatAppointment(current.starts_at, zone)}</p>
                <p className="mt-1 text-sm text-neutral-400">{current.status === "held"
                    ? `Held until ${new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(current.held_until!))} while they pay ${formatMoney(current.amount_cents)}. If they don't, the time is released.`
                    : `${current.booked_by === "staff" ? "Booked by your team" : "Booked on the booking page"}${current.paid_at ? `, paid ${formatMoney(current.amount_cents)}` : ""}.`}</p>
                <BookingActions workspaceSlug={workspace.slug} bookingId={current.id} status={current.status} />
            </div> : <p className="py-2 text-sm text-neutral-400">{latestDone ? `${latestDone.status === "showed" ? "Showed" : "No-show"} for ${formatAppointment(latestDone.starts_at, zone)}.` : lead.stage === "paid_not_booked" ? "Paid, no time booked yet. Their booking link lets them pick one without paying again." : "No time booked yet."}
                {source?.booking_slug && !current ? <span className="ml-1">Booking page: <span className="font-mono text-xs text-neutral-300">/book/{source.booking_slug}</span></span> : null}</p>}

            {paid.length ? <>
                <SectionHeading className="mt-8">Payments</SectionHeading>
                {paid.map(booking => <p key={booking.id} className="py-1.5 text-sm text-neutral-300">{formatMoney(booking.amount_cents)} on Stripe, {formatRelativeTime(booking.paid_at)} ago</p>)}
            </> : null}

            <SectionHeading className="mt-8">Form answers</SectionHeading>
            <dl>{lead.answers.map((answer, index) => <div key={`${answer.id ?? index}`} className="border-t border-card-border py-2 first:border-t-0">
                <dt className="text-xs text-neutral-500">{answer.question ?? answer.id}</dt><dd className="mt-0.5 text-sm text-neutral-200">{answer.answer}</dd>
            </div>)}</dl>

            <SectionHeading className="mt-8" count={activity.length}>Activity</SectionHeading>
            <ol>{activity.map(({ event, text }) => <li key={event.id} className="flex items-baseline justify-between gap-4 border-t border-card-border py-2 first:border-t-0">
                <span className="text-sm text-neutral-300">{text}</span><span className="shrink-0 text-xs tabular-nums text-neutral-500">{formatRelativeTime(event.created_at)} ago</span>
            </li>)}</ol>
        </div>
    </main>
}
