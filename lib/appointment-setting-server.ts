import "server-only"

import {
    DEFAULT_APPOINTMENT_SETTING_CONFIGURATION,
    normalizeAppointmentMediums,
    normalizeAppointmentRequestedFields,
    type AppointmentSettingAppointment,
    type AppointmentSettingConfiguration,
} from "@/lib/appointment-setting"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { appointmentNotificationStatus, type AppointmentDeliveryState } from "@/lib/appointment-setting-delivery"
import { resolveCommunicationDestinations } from "@/lib/client-messages/omnichannel"
import { loadAppointmentSettingServiceIds, type WorkspaceAccess } from "@/lib/workspace-access"

// Call only after verifying the viewer's Appointment Setting service assignment.
// Return delivery states only, never message bodies or channel credentials.
export async function loadAppointmentSettingDeliveryState(input: {
    workspaceId: string
    relationshipId: string
    appointments: AppointmentSettingAppointment[]
}): Promise<AppointmentDeliveryState> {
    const messageIds = input.appointments.flatMap((row) => row.submission_message_id ? [row.submission_message_id] : [])
    const [messaging, messages] = await Promise.all([
        resolveCommunicationDestinations({ workspaceId: input.workspaceId, relationshipId: input.relationshipId })
            .then((result) => result.destinations.length ? null : "Connect a client SMS or WhatsApp destination before submitting. You can continue saving drafts.")
            .catch(() => "Client messaging could not be verified. Check Communications before submitting."),
        messageIds.length
            ? supabaseAdmin.from("client_messages").select("id, status").eq("workspace_id", input.workspaceId).eq("relationship_id", input.relationshipId).in("id", messageIds)
            : Promise.resolve({ data: [], error: null }),
    ])
    return {
        checkedAt: Date.now(),
        messagingError: messaging,
        notificationError: messages.error ? "Notification status could not be loaded. Check Communications for delivery progress." : null,
        notifications: Object.fromEntries((messages.data ?? []).map((message) => [message.id, appointmentNotificationStatus(message.status)])),
    }
}

export async function loadAppointmentSettingRelationshipServices(access: WorkspaceAccess) {
    const appointmentSettingServices = await loadAppointmentSettingServiceIds(access.workspaceId)
    const grants = access.role === "staff"
        ? await supabaseAdmin.from("workspace_service_capabilities").select("service_id").eq("workspace_id", access.workspaceId).eq("capability", "appointment_setting.manage")
        : { data: null, error: null }
    if (grants.error) throw new Error("Could not verify Appointment Setting permissions.")
    const enabledServiceIds = new Set((grants.data ?? []).map((grant) => grant.service_id))
    const allowedServiceIds = access.role === "staff"
        ? new Set(access.allowedServiceIds)
        : null
    const serviceIds = [...appointmentSettingServices.ids].filter((serviceId) => (
        !allowedServiceIds || (allowedServiceIds.has(serviceId) && enabledServiceIds.has(serviceId))
    ))
    if (!serviceIds.length) return new Map<string, string>()

    let query = supabaseAdmin
        .from("relationship_services")
        .select("relationship_id, service_id, created_at")
        .eq("workspace_id", access.workspaceId)
        .in("service_id", serviceIds)
        .order("created_at", { ascending: true })
    // Eligibility opens the panel; only a client's actual assignee can book for it.
    if (access.role === "staff") query = query.eq("assignee_user_id", access.userId)
    const { data, error } = await query
    if (error) throw new Error(error.message)

    const servicesByRelationship = new Map<string, string>()
    for (const row of data ?? []) {
        if (!row.relationship_id || !row.service_id || servicesByRelationship.has(row.relationship_id)) continue
        servicesByRelationship.set(row.relationship_id, row.service_id)
    }
    return servicesByRelationship
}

export async function loadAppointmentSettingRelationshipService(access: WorkspaceAccess, relationshipId: string) {
    return (await loadAppointmentSettingRelationshipServices(access)).get(relationshipId) ?? null
}

export async function listAppointmentSettingAppointments(input: {
    workspaceId: string
    relationshipId: string
    serviceId: string
}): Promise<AppointmentSettingAppointment[]> {
    const { data, error } = await supabaseAdmin
        .from("appointment_setting_appointments")
        .select("id, workspace_id, relationship_id, service_id, contact_name, phone, appointment_at, appointment_date, appointment_time, appointment_timezone, meeting_medium, meeting_link, details, workflow_status, submitted_at, submitted_by, submission_message_id, created_by, updated_by, created_at, updated_at")
        .eq("workspace_id", input.workspaceId)
        .eq("relationship_id", input.relationshipId)
        .eq("service_id", input.serviceId)
        .order("workflow_status", { ascending: true })
        .order("appointment_at", { ascending: true })
        .order("created_at", { ascending: true })
    if (error) throw new Error(error.message)
    return (data ?? []) as AppointmentSettingAppointment[]
}

export async function loadAppointmentSettingConfiguration(input: {
    workspaceId: string
    relationshipId: string
    serviceId: string
}): Promise<AppointmentSettingConfiguration> {
    const { data, error } = await supabaseAdmin
        .from("relationship_appointment_setting_configs")
        .select("mediums, requested_fields")
        .eq("workspace_id", input.workspaceId)
        .eq("relationship_id", input.relationshipId)
        .eq("service_id", input.serviceId)
        .maybeSingle()
    if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return DEFAULT_APPOINTMENT_SETTING_CONFIGURATION
        throw new Error(error.message)
    }
    if (!data) return DEFAULT_APPOINTMENT_SETTING_CONFIGURATION
    const mediums = normalizeAppointmentMediums(data.mediums)
    return {
        mediums: mediums.length ? mediums : DEFAULT_APPOINTMENT_SETTING_CONFIGURATION.mediums,
        fields: normalizeAppointmentRequestedFields(data.requested_fields),
    }
}
