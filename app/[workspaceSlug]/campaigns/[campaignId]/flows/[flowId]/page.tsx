import { notFound } from "next/navigation"
import { DetailPageHeader } from "@/components/detail"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { FlowEditor } from "@/components/campaigns/FlowEditor"
import { shortId } from "@/components/campaigns/CampaignParts"
import { loadCampaign, requireCampaigns } from "@/lib/campaigns/server"
import { loadFlowEditor } from "@/lib/campaigns/flows-server"
import { formatRelativeTime } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

/** One text flow (docs/text-flows.md): its trigger, steps, replies, stop rules and sending hours, edited in place. */
export default async function CampaignFlowPage({ params }: { params: Promise<{ workspaceSlug: string; campaignId: string; flowId: string }> }) {
    const { workspaceSlug, campaignId, flowId } = await params
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const [loaded, editor] = await Promise.all([loadCampaign(workspace.id, campaignId), /^[0-9a-f-]{36}$/i.test(campaignId) ? loadFlowEditor(workspace.id, campaignId, flowId) : Promise.resolve(null)])
    if (!loaded || !editor) notFound()
    const base = `/${workspace.slug}/campaigns/${loaded.campaign.id}`
    return <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-5xl pt-5">
            <DetailPageHeader category="Text flow" reference={shortId(editor.flow.id)} title={editor.flow.name} subtitle={loaded.campaign.name}
                facts={[{ label: editor.inFlow.length === 1 ? "lead in it" : "leads in it", value: editor.inFlow.length }]} updated={formatRelativeTime(editor.updatedAt)} />
            <FlowEditor key={editor.flow.id} workspaceSlug={workspace.slug} campaignId={loaded.campaign.id} base={base} initial={editor.flow}
                sources={editor.sources} setters={editor.setters} previews={editor.previews} inFlow={editor.inFlow} numberName={editor.numberName} />
        </div>
    </main>
}
