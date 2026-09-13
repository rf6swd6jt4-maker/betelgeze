import { notFound } from "next/navigation"
import { DetailPageHeader } from "@/components/detail"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { SopWorkPilot } from "@/components/sops/SopWorkPilot"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { canAddSop } from "@/lib/sops/policy"
import { isSopId } from "@/lib/sops/records-policy"
import { getSopRecord, listSopAssets } from "@/lib/sops/records"
import { sopTestRelationships } from "@/lib/sops/work-server"
import { sopWorkConfiguration } from "@/lib/sops/work-worker"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
export const dynamic = "force-dynamic"
export default async function SopWorkPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string; id: string }>; searchParams: Promise<{run?: string}> }) {
    const { workspaceSlug, id } = await params
    const { run } = await searchParams
    if (!isSopId(id)) notFound()
    const { workspace, user, role, access } = await requireWorkspacePanel(workspaceSlug, "sops")
    if (!canAddSop(role)) notFound()
    const [sop, assets, relationships] = await Promise.all([getSopRecord(workspace.id, id), listSopAssets(workspace.id, id), sopTestRelationships(workspace.id)])
    if (!sop) notFound()
    return <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} workspaceAccess={access} currentProduct="client-work" />
        <div className="mx-auto max-w-5xl">
            <DetailPageHeader category="SOP work pilot" reference={shortId(sop.id)} title={sop.title} updated={formatRelativeTime(sop.updated_at)} subtitle="Generate Library work for a test relationship and measure the cost." />
            <SopWorkPilot workspaceSlug={workspace.slug} workspaceId={workspace.id} userId={user.id} sopId={id} assets={assets} relationships={relationships} ready={sopWorkConfiguration().ready && !sop.archived_at} initialRunId={run && isSopId(run) ? run : ""} />
        </div>
    </main>
}
