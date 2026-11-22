import { notFound } from "next/navigation"
import Link from "@/components/workspace/WorkspaceLink"
import { DetailDangerAction, DetailDangerZone, DetailPageHeader, SectionHeading } from "@/components/detail"
import { Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { RemoveSmsNumberButton, SmsNumberLabelField, SmsTestTextForm } from "@/components/signalhouse/SignalHouseControls"
import { requireCampaigns } from "@/lib/campaigns/server"
import { loadSignalHouse, loadSmsNumberUse } from "@/lib/signalhouse/server"
import { formatSmsNumber, registrationStatusLabels, smsNumberCanSend } from "@/lib/signalhouse/model"
import { formatRelativeTime } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

const propertyRow = "grid min-h-9 grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-2 py-1.5 text-sm"

/** One SignalHouse number: its label, what texts from it, its last 7 days, a test text, and removing it. */
export default async function SmsNumberPage({ params }: { params: Promise<{ workspaceSlug: string; numberId: string }> }) {
    const { workspaceSlug, numberId } = await params
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const [loaded, use] = await Promise.all([loadSignalHouse(workspace.id), loadSmsNumberUse(workspace.id)])
    const number = loaded.numbers.find(item => item.id === numberId && item.added_at && !item.removed_at)
    if (!number) notFound()
    const registration = loaded.registrations.find(item => item.account_id === number.account_id && item.external_id === number.registration_external_id)
    const ready = smsNumberCanSend(number, registration?.status)
    const health = (number.health.sevenDay && typeof number.health.sevenDay === "object" ? number.health.sevenDay : {}) as Record<string, number | null | undefined>
    const campaigns = use.campaigns.filter(item => item.sms_number_id === number.id)
    const sources = use.sources.filter(item => item.sms_number_id === number.id)
    const conversations = use.conversations.get(number.id) ?? 0
    const inUse = campaigns.length || sources.length ? "Pick another number where this one is used first." : conversations ? "Leads are texting with this number, so it stays." : null
    const stat = (label: string, value: string) => <p className="text-sm text-neutral-400">{label}<b className="mt-0.5 block text-xl font-semibold tabular-nums text-white">{value}</b></p>

    return <main className="min-h-screen bg-neutral-950 px-4 pb-10 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-4xl pt-5">
            <DetailPageHeader category="Number" reference={number.phone_e164.slice(-4)} title={formatSmsNumber(number.phone_e164)}
                subtitle={<Link href={`/${workspace.slug}/settings/signalhouse`} className="hover:underline">SignalHouse</Link>}
                labels={ready ? <Status label="Ready" tone="green" /> : <Status label={number.status === "RELEASED" ? "Released" : "Waiting on registration"} tone={number.status === "RELEASED" ? "red" : "yellow"} />}
                facts={[{ label: conversations === 1 ? "lead texting" : "leads texting", value: conversations }]}
                updated={formatRelativeTime(number.synced_at)} />

            <div className="flex flex-col gap-8 pt-5">
                <section aria-label="Label">
                    <SectionHeading>Label</SectionHeading>
                    <p className="mb-2 text-xs text-neutral-500">Shown wherever a number is picked, so your team can tell them apart.</p>
                    <SmsNumberLabelField workspaceSlug={workspace.slug} numberId={number.id} label={number.label} />
                </section>

                <section aria-label="Details">
                    <SectionHeading>Details</SectionHeading>
                    <div className={propertyRow}><span className="text-neutral-500">Registration</span><span className="text-neutral-200"><span className="font-mono text-xs">{number.registration_external_id ?? "None"}</span>{registration ? <span className="text-neutral-500"> · {registrationStatusLabels[registration.status] ?? registration.status}</span> : null}</span></div>
                    <div className={propertyRow}><span className="text-neutral-500">Can send</span><span className="text-neutral-200">{number.capabilities.length ? number.capabilities.join(" and ") : "SMS"}</span></div>
                    <div className={propertyRow}><span className="text-neutral-500">SignalHouse</span><span className="text-neutral-200">{number.status || "Unknown"}</span></div>
                </section>

                <section aria-label="Used by">
                    <SectionHeading>Used by</SectionHeading>
                    {campaigns.length || sources.length ? <ul className="flex flex-col">{[
                        ...campaigns.map(item => <li key={item.id} className="flex min-h-9 items-center justify-between gap-3 border-t border-card-border py-1.5 text-sm first:border-t-0"><Link href={`/${workspace.slug}/campaigns/${item.id}?tab=flows`} className="truncate hover:underline">{item.name}</Link><span className="shrink-0 text-xs text-neutral-500">Default for the campaign</span></li>),
                        ...sources.map(item => <li key={item.id} className="flex min-h-9 items-center justify-between gap-3 border-t border-card-border py-1.5 text-sm first:border-t-0"><Link href={`/${workspace.slug}/campaigns/${item.campaign_id}/sources/${item.id}`} className="truncate hover:underline">{item.name}</Link><span className="shrink-0 text-xs text-neutral-500">Its own number</span></li>),
                    ]}</ul> : <p className="text-sm text-neutral-500">Not used yet. Pick it on a campaign&apos;s Text flows tab or a source&apos;s page.</p>}
                </section>

                <section aria-label="Last 7 days">
                    <SectionHeading>Last 7 days</SectionHeading>
                    <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                        {stat("Sent", typeof health.messagesSent === "number" ? health.messagesSent.toLocaleString("en-US") : "–")}
                        {stat("Delivered", typeof health.deliveryRate === "number" ? `${health.deliveryRate}%` : "–")}
                        {stat("Failed", typeof health.messagesFailed === "number" ? health.messagesFailed.toLocaleString("en-US") : "–")}
                        {stat("Opt-outs", typeof health.optOuts === "number" ? String(health.optOuts) : "–")}
                    </div>
                    <p className="mt-2 text-xs text-neutral-500">From SignalHouse, refreshed each time the account is read.</p>
                </section>

                <section aria-label="Test text">
                    <SectionHeading>Test text</SectionHeading>
                    <SmsTestTextForm workspaceSlug={workspace.slug} numberId={number.id} disabledReason={ready ? null : "This number cannot send until its 10DLC registration is active and SignalHouse has it ready."} />
                </section>
            </div>

            <DetailDangerZone>
                <DetailDangerAction title="Remove from Betelgeze" description={inUse ?? "It stays in your SignalHouse account and can be added again."} control={<RemoveSmsNumberButton workspaceSlug={workspace.slug} numberId={number.id} blockedReason={inUse} />} />
            </DetailDangerZone>
        </div>
    </main>
}
