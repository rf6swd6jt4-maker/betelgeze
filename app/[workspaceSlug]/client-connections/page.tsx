import { ClientConnectionsWorkspace } from "@/components/client-connections/ClientConnectionsWorkspace"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { readCurrentClientConnections } from "@/lib/client-connections"
import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { FramedClientPageHeader } from "@/components/relationships/FramedClientPageHeader"
import { clientPageTabs } from "@/lib/client-page"
import { relationshipContextShortcuts } from "@/lib/relationship-context"
import { getRelationship } from "@/lib/relationships"
import { workspaceLayoutFor } from "@/lib/workspace-layout"
import { listWorkspaceConnections } from "@/lib/workspace-integrations"

export const dynamic = "force-dynamic"

export default async function ClientConnectionsPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ relationship?: string }> }) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const relationshipId = typeof query.relationship === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(query.relationship) ? query.relationship : undefined
    const authorization = await requireWorkspacePanel(workspaceSlug, "client-connections")
    // Today layout, narrowed to one client: this is the Connections tab of their page, so it carries their header.
    // One single-row read, alongside the two this page already makes; the unfiltered page and the tabbed layout add none.
    const clientTab = relationshipId && workspaceLayoutFor(authorization.workspace.id, authorization.user.id) === "today" ? relationshipId : null
    const [accounts, connections, client] = await Promise.all([
        readCurrentClientConnections(authorization.workspace.id, authorization.user.id, relationshipId),
        listWorkspaceConnections(authorization.workspace.id),
        clientTab ? requireRelationshipAccess(authorization.access, clientTab).then(() => getRelationship(authorization.workspace.id, clientTab)) : null,
    ])
    const highLevel = connections.find((connection) => connection.provider === "ghl")
    return <main className="min-h-screen bg-neutral-950 text-white">
        <WorkspaceTopBar userId={authorization.user.id} workspace={authorization.workspace} workspaceAccess={authorization.access} currentProduct="client-work" />
        <ClientConnectionsWorkspace workspaceSlug={workspaceSlug} accounts={accounts} agency={{ connected: Boolean(highLevel?.enabled), name: typeof highLevel?.config_hint.company_name === "string" ? highLevel.config_hint.company_name : null, id: typeof highLevel?.config_hint.company_id === "string" ? highLevel.config_hint.company_id : null }} canManageAgency={authorization.role === "owner" || authorization.role === "admin"}
            clientHeader={client ? <FramedClientPageHeader workspaceSlug={workspaceSlug} relationshipId={client.id} name={client.primary_person_name} business={client.business_name} phase={client.lifecycle_phase}
                isTest={client.source_metadata.is_test === true} tabs={clientPageTabs(workspaceSlug, client.id, relationshipContextShortcuts(authorization.access.capabilities, true))} active="connections" chat={false} /> : null} />
    </main>
}
