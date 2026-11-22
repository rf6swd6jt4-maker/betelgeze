import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { DetailPageHeader, SectionHeading } from "@/components/detail"
import { TextingNumberField } from "@/components/campaigns/TextingNumberField"
import { loadUsableSmsNumbers } from "@/lib/signalhouse/server"
import { smsNumberName } from "@/lib/signalhouse/model"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { SourceSettings } from "@/components/campaigns/SourceSettings"
import { SourceStatusBar } from "@/components/campaigns/SourceStatusBar"
import { SourceTag, shortId } from "@/components/campaigns/CampaignParts"
import { loadCampaign, loadCampaignSource, loadSourceStats, requireCampaigns } from "@/lib/campaigns/server"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { SetterField } from "@/components/campaigns/LeadMarks"
import { loadSetters } from "@/lib/campaigns/flows-server"

export const dynamic = "force-dynamic"

export default async function CampaignSourcePage({ params }: { params: Promise<{ workspaceSlug: string; campaignId: string; sourceId: string }> }) {
    const { workspaceSlug, campaignId, sourceId } = await params
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const [loaded, source, stats, requestHeaders, numbers, setters] = await Promise.all([
        loadCampaign(workspace.id, campaignId), loadCampaignSource(workspace.id, sourceId), loadSourceStats(workspace.id, sourceId), headers(), loadUsableSmsNumbers(workspace.id), loadSetters(workspace.id),
    ])
    if (!loaded || !source || source.campaign_id !== loaded.campaign.id) notFound()
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "app.betelgeze.com"
    const appOrigin = `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`

    return <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-4xl pt-5">
            <DetailPageHeader category="Source" reference={shortId(source.id)} title={source.name} subtitle={loaded.campaign.name}
                labels={<SourceTag source={source} />}
                facts={[{ label: stats.week === 1 ? "lead this week" : "leads this week", value: stats.week }]}
                updated={formatRelativeTime(source.updated_at)} />
            <SourceStatusBar workspaceSlug={workspace.slug} campaignId={loaded.campaign.id} sourceId={source.id} status={source.status} pageUrl={source.page_url} books={source.books} hasLead={Boolean(stats.lastAt)} appOrigin={appOrigin} />
            <SourceSettings key={source.id} workspaceSlug={workspace.slug} source={source} appOrigin={appOrigin} />
            {/* Texting: the campaign's number, or this source's own (docs/signalhouse.md). */}
            <section aria-label="Texting" className="mt-8">
                <SectionHeading>Texting</SectionHeading>
                <div className="grid grid-cols-1 items-start gap-1.5 py-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                    <div className="pt-2 text-sm text-neutral-500">Texts from</div>
                    <div className="min-w-0 max-w-xl">
                        <TextingNumberField workspaceSlug={workspace.slug} kind="source" targetId={source.id} value={source.sms_number_id} label="Number this source texts from"
                            inheritLabel={`Campaign's number · ${smsNumberName(numbers.find(number => number.id === loaded.campaign.sms_number_id))}`}
                            options={numbers.map(number => ({ id: number.id, name: smsNumberName(number), canSend: number.canSend }))} />
                        <p className="mt-1.5 text-xs leading-5 text-neutral-500">{source.sms_number_id ? "Its own number, instead of the campaign's." : "Uses the campaign's number. Pick another to give this source its own, for example a local area code."} Replies come back to the same conversation.</p>
                    </div>
                </div>
                <div className="grid grid-cols-1 items-start gap-1.5 py-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                    <div className="pt-2 text-sm text-neutral-500">Default setter</div>
                    <div className="min-w-0 max-w-xl">
                        <SetterField workspaceSlug={workspace.slug} target="source" id={source.id} value={source.setter_user_id} people={setters} />
                        <p className="mt-1.5 text-xs leading-5 text-neutral-500">New leads from this source get this setter. Text flows sign with their first name, and call tasks are theirs.</p>
                    </div>
                </div>
            </section>
        </div>
    </main>
}
