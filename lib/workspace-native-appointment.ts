import "server-only"

import { notFound } from "next/navigation"
import { loadRelationshipContext } from "@/components/workspace/ClientContextPanel"
import { filterAppointmentSettingRelationships } from "@/lib/appointment-setting"
import { listAppointmentSettingAppointments, loadAppointmentSettingConfiguration, loadAppointmentSettingDeliveryState, loadAppointmentSettingRelationshipService, loadAppointmentSettingRelationshipServices } from "@/lib/appointment-setting-server"
import { getRelationship, listRelationshipsForWorkspace, relationshipLocationLabel } from "@/lib/relationships"
import { accessibleRelationshipIds, requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { workspaceNativePanelsEnabled } from "@/lib/workspace-native"

export async function loadNativeAppointment(workspaceSlug: string, relationshipId?: string) {
    const { workspace, user, role, access } = await requireWorkspacePanel(workspaceSlug, "appointment-setting")
    const identity = { userId: user.id, workspaceId: workspace.id, workspaceSlug: workspace.slug }
    if (relationshipId) {
        await requireRelationshipAccess(access, relationshipId)
        const [relationship, serviceId] = await Promise.all([getRelationship(workspace.id, relationshipId), loadAppointmentSettingRelationshipService(access, relationshipId)])
        if (!relationship || !serviceId || relationship.status === "archived" || relationship.lifecycle_phase !== "retention") notFound()
        const [appointments, configuration, context] = await Promise.all([
            listAppointmentSettingAppointments({ workspaceId: workspace.id, relationshipId, serviceId }),
            loadAppointmentSettingConfiguration({ workspaceId: workspace.id, relationshipId, serviceId }),
            loadRelationshipContext({ workspaceSlug, relationship, access }),
        ])
        const delivery = await loadAppointmentSettingDeliveryState({ workspaceId: workspace.id, relationshipId, appointments })
        return {
            ...identity, kind: "appointment-detail" as const, context,
            relationship: { id: relationship.id, primary_person_name: relationship.primary_person_name, business_name: relationship.business_name, isTest: relationship.source_metadata.is_test === true },
            latestUpdatedAt: appointments.reduce((latest, appointment) => appointment.updated_at > latest ? appointment.updated_at : latest, relationship.updated_at),
            appointments, configuration, delivery, serviceId,
            draftCommandsEnabled: workspaceNativePanelsEnabled(workspace.id, process.env.WORKSPACE_NATIVE_PANELS),
        }
    }
    const [relationships, allowedRelationshipIds, services] = await Promise.all([
        listRelationshipsForWorkspace(workspace.id), accessibleRelationshipIds(access), loadAppointmentSettingRelationshipServices(access),
    ])
    const eligible = filterAppointmentSettingRelationships(relationships, allowedRelationshipIds, new Set(services.keys()))
    return {
        ...identity, kind: "appointment-setting" as const, context: null, role,
        relationships: eligible.map((relationship) => ({
            id: relationship.id, primary_person_name: relationship.primary_person_name, business_name: relationship.business_name,
            primary_contact_role: relationship.primary_contact_role, primary_email: relationship.primary_email, updated_at: relationship.updated_at,
            location: relationshipLocationLabel(relationship), phone: (relationship.whatsapp_phone ?? relationship.primary_phone)?.replace(/^(?:sms|whatsapp):/i, "") ?? null,
            isTest: Boolean(relationship.source_metadata.is_test),
        })),
    }
}

export type NativeAppointmentSnapshot = Awaited<ReturnType<typeof loadNativeAppointment>>
