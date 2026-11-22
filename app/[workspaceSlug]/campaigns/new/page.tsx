import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { NewCampaignForm } from "@/components/campaigns/NewCampaignForm"
import { requireCampaigns } from "@/lib/campaigns/server"

export const dynamic = "force-dynamic"

export default async function NewCampaignPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    return <main className="min-h-screen bg-neutral-950 px-4 pb-10 pt-5 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl">
            <PanelTabHeader title="New campaign" description="A campaign starts as a draft. Add its sources next: the landing pages your ads send people to." />
            <NewCampaignForm workspaceSlug={workspace.slug} />
        </div>
    </main>
}
