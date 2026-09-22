import { ClientConnectionsWorkspace } from "@/components/client-connections/ClientConnectionsWorkspace"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { listClientConnections } from "@/lib/client-connections"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { listWorkspaceConnections } from "@/lib/workspace-integrations"

export const dynamic = "force-dynamic"

export default async function ClientConnectionsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const authorization = await requireWorkspacePanel(workspaceSlug, "client-connections")
    const [accounts, connections] = await Promise.all([
        listClientConnections(authorization.workspace.id, authorization.user.id),
        listWorkspaceConnections(authorization.workspace.id),
    ])
    const highLevel = connections.find((connection) => connection.provider === "ghl")
    return <main className="min-h-screen bg-neutral-950 text-white">
        <WorkspaceTopBar userId={authorization.user.id} workspace={authorization.workspace} workspaceAccess={authorization.access} currentProduct="client-work" />
        <ClientConnectionsWorkspace workspaceSlug={workspaceSlug} accounts={accounts} agency={{ connected: Boolean(highLevel?.enabled), name: typeof highLevel?.config_hint.company_name === "string" ? highLevel.config_hint.company_name : null, id: typeof highLevel?.config_hint.company_id === "string" ? highLevel.config_hint.company_id : null }} canManageAgency={authorization.role === "owner" || authorization.role === "admin"} />
    </main>
}
