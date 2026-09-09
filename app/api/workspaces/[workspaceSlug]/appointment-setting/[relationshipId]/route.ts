import { notFound } from "next/navigation"
import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { getRelationship } from "@/lib/relationships"
import { listAppointmentSettingAppointments, loadAppointmentSettingDeliveryState, loadAppointmentSettingRelationshipService } from "@/lib/appointment-setting-server"

export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ workspaceSlug: string; relationshipId: string }> }) {
    const { workspaceSlug, relationshipId } = await context.params
    const { workspace, access } = await requireWorkspacePanel(workspaceSlug, "appointment-setting")
    await requireRelationshipAccess(access, relationshipId)
    const [relationship, serviceId] = await Promise.all([
        getRelationship(workspace.id, relationshipId),
        loadAppointmentSettingRelationshipService(access, relationshipId),
    ])
    if (!relationship || !serviceId || relationship.status === "archived" || relationship.lifecycle_phase !== "retention") notFound()
    try {
        const appointments = await listAppointmentSettingAppointments({ workspaceId: workspace.id, relationshipId, serviceId })
        const delivery = await loadAppointmentSettingDeliveryState({ workspaceId: workspace.id, relationshipId, appointments })
        return Response.json({ appointments, delivery }, { headers: { "Cache-Control": "private, no-store" } })
    } catch {
        return Response.json({ error: "Could not refresh appointments." }, { status: 503, headers: { "Cache-Control": "private, no-store" } })
    }
}
