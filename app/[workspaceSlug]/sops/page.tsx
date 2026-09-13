import { notFound } from "next/navigation"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { SopCatalogue } from "@/components/sops/SopCatalogue"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { canAddSop, sopCursor } from "@/lib/sops/policy"
import { listSopRecords } from "@/lib/sops/records"
export const dynamic = "force-dynamic"
export default async function SopsPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ cursor?: string; archived?: string }> }) {
    const { workspaceSlug } = await params
    const { workspace, user, role, access } = await requireWorkspacePanel(workspaceSlug, "sops")
    const { cursor, archived } = await searchParams
    try { sopCursor(cursor) } catch { notFound() }
    const catalogue = await listSopRecords(workspace.id, cursor, archived === "1")
    return <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} workspaceAccess={access} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl"><PanelTabHeader title="SOPs" description="Procedures, guidance and supporting assets for your team." />
            <SopCatalogue workspaceSlug={workspace.slug} workspaceId={workspace.id} userId={user.id} canAdd={canAddSop(role)} items={catalogue.items} next={catalogue.next} paged={Boolean(cursor)} archived={archived === "1"} />
        </div>
    </main>
}
