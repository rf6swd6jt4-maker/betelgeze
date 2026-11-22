import { headers } from "next/headers"
import { redirect } from "next/navigation"
import Link from "@/components/workspace/WorkspaceLink"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeading, TableRow } from "@/components/list/Table"
import { Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { loadCampaigns, requireCampaigns } from "@/lib/campaigns/server"
import { workspaceTabRedirectUrl } from "@/lib/workspace-tabs"

export const dynamic = "force-dynamic"

const statusTone = { live: "green", paused: "yellow", draft: "grey" } as const

/** With one campaign there is nothing to choose: it opens straight away, in the same tab. */
export default async function CampaignsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const campaigns = await loadCampaigns(workspace.id)
    // Inside a workspace tab the redirect must keep the tab's identity; without it the frame loads a second app shell,
    // which opens this page again, without end.
    if (campaigns.length === 1) redirect(workspaceTabRedirectUrl(`/${workspace.slug}/campaigns/${campaigns[0].id}`, (await headers()).get("x-betelgeze-current-path")))

    return <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl">
            <PanelTabHeader title="Campaigns" description="Scaylup's own ad campaigns. Each has its sources, pipeline and booking pages." />
            <Table ariaLabel="Campaigns">
                <TableHead><TableHeading>Campaign</TableHeading><TableHeading>Status</TableHeading></TableHead>
                <TableBody>
                    {campaigns.length ? campaigns.map(campaign => <TableRow key={campaign.id}>
                        <TableCell primary><Link data-table-open href={`/${workspace.slug}/campaigns/${campaign.id}`} className="hover:underline">{campaign.name}</Link></TableCell>
                        <TableCell><Status label={campaign.status[0].toUpperCase() + campaign.status.slice(1)} tone={statusTone[campaign.status as keyof typeof statusTone] ?? "grey"} /></TableCell>
                    </TableRow>) : <TableEmpty columns={2}>No campaigns yet.</TableEmpty>}
                </TableBody>
            </Table>
        </div>
    </main>
}
