import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { DetailPageHeader } from "@/components/detail"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { SourceSettings } from "@/components/campaigns/SourceSettings"
import { SourceStatusBar } from "@/components/campaigns/SourceStatusBar"
import { SourceTag, shortId } from "@/components/campaigns/CampaignParts"
import { loadCampaign, loadCampaignSource, loadSourceStats, requireCampaigns } from "@/lib/campaigns/server"
import { formatRelativeTime } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

export default async function CampaignSourcePage({ params }: { params: Promise<{ workspaceSlug: string; campaignId: string; sourceId: string }> }) {
    const { workspaceSlug, campaignId, sourceId } = await params
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const [loaded, source, stats, requestHeaders] = await Promise.all([
        loadCampaign(workspace.id, campaignId), loadCampaignSource(workspace.id, sourceId), loadSourceStats(workspace.id, sourceId), headers(),
    ])
    if (!loaded || !source || source.campaign_id !== loaded.campaign.id) notFound()
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "app.betelgeze.com"
    const appOrigin = `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`

    return <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-4xl pt-5">
            <DetailPageHeader category="Source" reference={shortId(source.id)} title={source.name} subtitle={loaded.campaign.name}
                labels={<SourceTag source={source} />}
                facts={[{ label: "this week", value: stats.week }]}
                updated={stats.lastAt ? `Last lead ${formatRelativeTime(stats.lastAt)} ago` : "No leads yet"} />
            <SourceStatusBar workspaceSlug={workspace.slug} campaignId={loaded.campaign.id} sourceId={source.id} status={source.status} pageUrl={source.page_url} books={source.books} hasLead={Boolean(stats.lastAt)} appOrigin={appOrigin} />
            <SourceSettings key={source.id} workspaceSlug={workspace.slug} source={source} appOrigin={appOrigin} />
        </div>
    </main>
}
