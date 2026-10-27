import { ClientConnectionsWorkspace } from "@/components/client-connections/ClientConnectionsWorkspace"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { readCurrentClientConnections } from "@/lib/client-connections"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { listWorkspaceConnections } from "@/lib/workspace-integrations"

export const dynamic = "force-dynamic"

export default async function ClientConnectionsPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ relationship?: string }> }) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const relationshipId = typeof query.relationship === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(query.relationship) ? query.relationship : undefined
    const authorization = await requireWorkspacePanel(workspaceSlug, "client-connections")
    const [accounts, connections] = await Promise.all([
        readCurrentClientConnections(authorization.workspace.id, authorization.user.id, relationshipId),
        listWorkspaceConnections(authorization.workspace.id),
    ])
    const highLevel = connections.find((connection) => connection.provider === "ghl")
    return <main className="min-h-screen bg-neutral-950 text-white">
        <WorkspaceTopBar userId={authorization.user.id} workspace={authorization.workspace} workspaceAccess={authorization.access} currentProduct="client-work" />
        <ClientConnectionsWorkspace workspaceSlug={workspaceSlug} accounts={accounts} agency={{ connected: Boolean(highLevel?.enabled), name: typeof highLevel?.config_hint.company_name === "string" ? highLevel.config_hint.company_name : null, id: typeof highLevel?.config_hint.company_id === "string" ? highLevel.config_hint.company_id : null }} canManageAgency={authorization.role === "owner" || authorization.role === "admin"} />
    </main>
}
