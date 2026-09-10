import "server-only"

import { after } from "next/server"
import { processAppointmentNotificationOutbox } from "@/lib/appointment-notification-worker"
import { workspaceNativePanelsEnabled } from "@/lib/workspace-native"
import { revalidatePath } from "next/cache"
import { createHash } from "node:crypto"
import type { AppointmentDraftCommandIdentity } from "@/lib/appointment-draft-command"
import { appointmentNotificationStatus, deliverAppointmentSubmission, type AppointmentNotificationStatus } from "@/lib/appointment-setting-delivery"
import { recordClientAdminActivity } from "@/lib/admin/activity"
import {
    APPOINTMENT_FIELD_OPTIONS,
    formatAppointmentNotification,
    formatUsPhone,
    appointmentReadiness,
    type AppointmentDraftChanges,
    type AppointmentUpdateField,
    type AppointmentFieldKey,
    type AppointmentMedium,
    type AppointmentSettingAppointment,
    type AppointmentSettingConfiguration,
} from "@/lib/appointment-setting"
import { loadAppointmentSettingConfiguration, loadAppointmentSettingRelationshipService } from "@/lib/appointment-setting-server"
import { resolveCommunicationDestinations, sendCommunicationDeliveries } from "@/lib/client-messages/omnichannel"
import { getRelationship } from "@/lib/relationships"
import { getClientPortalUrlForOnboardingSession } from "@/lib/client-portal/session"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import type { WorkspaceMutationResult } from "@/lib/workspace-mutations"

export type { AppointmentUpdateField } from "@/lib/appointment-setting"

export type AppointmentSubmission = {
    appointment: AppointmentSettingAppointment
    notificationStatus: AppointmentNotificationStatus
    notificationError: string | null
}

const APPOINTMENT_SELECT = "id, workspace_id, relationship_id, service_id, contact_name, phone, appointment_at, appointment_date, appointment_time, appointment_timezone, meeting_medium, meeting_link, details, workflow_status, submitted_at, submitted_by, submission_message_id, created_by, updated_by, created_at, updated_at"

function detailPath(workspaceSlug: string, relationshipId: string) {
    return `/${workspaceSlug}/appointment-setting/${relationshipId}`
}

function cleanOptionalText(value: string, maximum: number) {
    const cleaned = value.trim().replace(/\s+/g, " ")
    return cleaned.length <= maximum ? cleaned : null
}

function cleanTimezone(value: string) {
    const cleaned = value.trim()
    if (!cleaned || cleaned.length > 100) return null
    try {
        new Intl.DateTimeFormat("en", { timeZone: cleaned }).format(new Date())
        return cleaned
    } catch {
        return null
    }
}

function cleanAppointmentDate(value: string) {
    const cleaned = value.trim()
    if (!cleaned) return ""
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return null
    const parsed = new Date(`${cleaned}T12:00:00Z`)
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== cleaned ? null : cleaned
}

function cleanAppointmentTime(value: string) {
    const cleaned = value.trim()
    if (!cleaned) return ""
    const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(cleaned)
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null
    return `${match[1]}:${match[2]}`
}

function cleanMeetingLink(value: string) {
    const cleaned = value.trim()
    if (!cleaned) return ""
    try {
        const url = new URL(cleaned)
        return url.protocol === "https:" && cleaned.length <= 2_000 ? cleaned : null
    } catch {
        return null
    }
}

async function requireAppointmentSettingContext(workspaceSlug: string, relationshipId: string) {
    const context = await requireWorkspacePanel(workspaceSlug, "appointment-setting")
    await requireRelationshipAccess(context.access, relationshipId)
    const [relationship, serviceId] = await Promise.all([
        getRelationship(context.workspace.id, relationshipId),
        loadAppointmentSettingRelationshipService(context.access, relationshipId),
    ])
    if (!relationship || relationship.status === "archived" || relationship.lifecycle_phase !== "retention") {
        throw new Error("This relationship is not available for Appointment Setting.")
    }
    if (!serviceId) throw new Error("This relationship does not have an accessible Appointment Setting service.")
    const configuration = await loadAppointmentSettingConfiguration({ workspaceId: context.workspace.id, relationshipId, serviceId })
    return { ...context, relationship, serviceId, configuration }
}

function normalizeDetail(key: AppointmentFieldKey, value: string) {
    if (key === "phone") return value.trim() ? formatUsPhone(value) : ""
    const maximum = key === "notes" ? 1_000 : key === "address" ? 300 : 200
    const cleaned = key === "notes" ? (value.trim().length <= maximum ? value.trim() : null) : cleanOptionalText(value, maximum)
    if (cleaned === null) return null
    if (key === "email" && cleaned && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return null
    return cleaned
}

function validateSubmission(row: AppointmentSettingAppointment, configuration: AppointmentSettingConfiguration) {
    const issues = appointmentReadiness(row, configuration)
    if (issues.length) return { ok: false as const, error: issues[0].message, fieldErrors: Object.fromEntries(issues.map((issue) => [issue.field, issue.message])) }
    const contactName = cleanOptionalText(row.contact_name ?? "", 160)
    const appointmentDate = cleanAppointmentDate(row.appointment_date ?? "")
    const appointmentTime = cleanAppointmentTime(row.appointment_time ?? "")
    const appointmentTimezone = cleanTimezone(row.appointment_timezone)
    if (!contactName) return { ok: false as const, error: "Add the lead's name before submitting." }
    if (!appointmentDate || !appointmentTime || !appointmentTimezone) return { ok: false as const, error: "Add a valid appointment date and time before submitting." }
    if (!configuration.mediums.includes(row.meeting_medium)) return { ok: false as const, error: "Choose an available appointment option." }
    const meetingLink = row.meeting_medium === "phone" ? "" : cleanMeetingLink(row.meeting_link ?? "")
    if (meetingLink === null || (row.meeting_medium !== "phone" && !meetingLink)) return { ok: false as const, error: "Add a valid HTTPS meeting link before submitting." }
    for (const requested of configuration.fields) {
        const value = requested.key === "phone" ? row.phone ?? "" : String(row.details?.[requested.key] ?? "")
        const cleaned = normalizeDetail(requested.key, value)
        const label = APPOINTMENT_FIELD_OPTIONS.find((option) => option.key === requested.key)?.label ?? "This field"
        if (cleaned === null) return { ok: false as const, error: requested.key === "phone" ? "Add a valid 10-digit US phone number." : `Add a valid ${label.toLowerCase()}.` }
        if (requested.required && !cleaned) return { ok: false as const, error: `${label} is required before submitting.` }
    }
    return { ok: true as const, value: { contactName, appointmentDate, appointmentTime, appointmentTimezone, meetingLink: meetingLink || null } }
}

export async function createAppointmentSettingDraft(workspaceSlug: string, relationshipId: string, appointmentTimezone: string): Promise<WorkspaceMutationResult<AppointmentSettingAppointment>> {
    const { workspace, user, serviceId, configuration } = await requireAppointmentSettingContext(workspaceSlug, relationshipId)
    const timezone = cleanTimezone(appointmentTimezone)
    if (!timezone) return { ok: false, error: "Choose the appointment timezone before creating a draft." }
    const { data, error } = await supabaseAdmin.from("appointment_setting_appointments").insert({
        workspace_id: workspace.id,
        relationship_id: relationshipId,
        service_id: serviceId,
        contact_name: null,
        phone: null,
        appointment_at: null,
        appointment_date: null,
        appointment_time: null,
        appointment_timezone: timezone,
        meeting_medium: configuration.mediums[0] ?? "phone",
        meeting_link: null,
        details: {},
        workflow_status: "draft",
        created_by: user.id,
        updated_by: user.id,
    }).select(APPOINTMENT_SELECT).single()
    if (error || !data) {
        console.error("Appointment Setting draft could not be created", { workspaceId: workspace.id, relationshipId, code: error?.code })
        return { ok: false, error: "We couldn't add an appointment draft. Try again." }
    }
    revalidatePath(detailPath(workspaceSlug, relationshipId))
    return { ok: true, data: data as AppointmentSettingAppointment }
}

export async function updateAppointmentSettingAppointment(workspaceSlug: string, relationshipId: string, appointmentId: string, field: AppointmentUpdateField, value: string, expectedUpdatedAt: string): Promise<WorkspaceMutationResult<AppointmentSettingAppointment>> {
    return saveAppointmentSettingDraft(workspaceSlug, relationshipId, appointmentId, { [field]: value }, expectedUpdatedAt)
}

export async function saveAppointmentSettingDraft(workspaceSlug: string, relationshipId: string, appointmentId: string, changes: AppointmentDraftChanges, expectedUpdatedAt: string, command?: AppointmentDraftCommandIdentity, expectedUserId?: string): Promise<WorkspaceMutationResult<AppointmentSettingAppointment>> {
    const { workspace, user, serviceId, configuration } = await requireAppointmentSettingContext(workspaceSlug, relationshipId)
    if ((command && command.expectedUserId !== user.id) || (expectedUserId && expectedUserId !== user.id)) return { ok: false, error: "Your account changed. Reopen this draft with the original account before saving." }
    const { data: current, error: readError } = await supabaseAdmin.from("appointment_setting_appointments").select(APPOINTMENT_SELECT).eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("service_id", serviceId).eq("id", appointmentId).maybeSingle()
    if (readError) throw new Error("Could not confirm the current draft. Your changes are preserved for retry.")
    if (!current) return { ok: false, error: "That appointment draft is no longer available." }
    if (!command && current.workflow_status !== "draft") return { ok: false, error: "Submitted appointments can no longer be edited here." }
    if (!command && current.updated_at !== expectedUpdatedAt) return { ok: false, conflict: true, error: "This draft changed. Review its latest details and try again." }
    const update: Record<string, unknown> = { updated_by: user.id }
    if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).length > 12) return { ok: false, error: "Invalid draft changes." }
    const requestHash = command ? createHash("sha256").update(JSON.stringify({ expectedUpdatedAt, changes: Object.fromEntries(Object.entries(changes).sort(([a], [b]) => a.localeCompare(b))) })).digest("hex") : null
    const commit = async (): Promise<WorkspaceMutationResult<AppointmentSettingAppointment>> => {
        const { data: receipt, error } = await supabaseAdmin.rpc("save_appointment_setting_draft_command", {
            p_workspace_id: workspace.id, p_relationship_id: relationshipId, p_service_id: serviceId,
            p_appointment_id: appointmentId, p_user_id: user.id, p_expected_updated_at: expectedUpdatedAt,
            p_request_id: command!.requestId, p_request_hash: requestHash, p_changes: update,
        })
        if (error) {
            if (error.code === "40001") return { ok: false, conflict: true, error: "This draft changed. Review its latest details and try again." }
            if (error.code === "42501" || error.code === "P0002") return { ok: false, conflict: true, error: "This draft is no longer available for editing. Your changes are preserved." }
            if (error.code === "22023") return { ok: false, error: "That save request could not be verified. Review the draft before retrying." }
            if (["23514", "22001", "22P02"].includes(error.code)) return { ok: false, error: "The draft no longer matches this client's requirements. Review the values before saving again." }
            // A network error can hide an accepted transaction. Keep the same
            // durable request ID so a retry observes its receipt, never re-applies it.
            throw new Error("The save could not be confirmed. Your changes are preserved for retry.")
        }
        if (!receipt?.appointment || !receipt?.version) throw new Error("The save could not be confirmed. Retry your preserved changes.")
        return { ok: true, data: receipt.appointment as AppointmentSettingAppointment, version: receipt.version }
    }
    // A replay may follow another edit or submission. The database verifies the
    // original receipt before considering the current version/configuration.
    if (command && (current.updated_at !== expectedUpdatedAt || current.workflow_status !== "draft")) return commit()
    for (const [field, value] of Object.entries(changes)) {
        if (typeof value !== "string") return { ok: false, error: "Invalid draft value." }
        const result = ((): WorkspaceMutationResult => {
            if (field === "contact_name") {
                const cleaned = cleanOptionalText(value, 160)
                if (cleaned === null) return { ok: false, error: "Use a name of 160 characters or fewer." }
                update.contact_name = cleaned || null
            } else if (field === "appointment_date") {
                const cleaned = cleanAppointmentDate(value)
                if (cleaned === null) return { ok: false, error: "Add a valid appointment date." }
                update.appointment_date = cleaned || null
            } else if (field === "appointment_time") {
                const cleaned = cleanAppointmentTime(value)
                if (cleaned === null) return { ok: false, error: "Add a valid appointment time." }
                update.appointment_time = cleaned || null
            } else if (field === "appointment_timezone") {
                const cleaned = cleanTimezone(value)
                if (!cleaned) return { ok: false, error: "Choose a valid appointment timezone." }
                update.appointment_timezone = cleaned
            } else if (field === "meeting_medium") {
                if (!configuration.mediums.includes(value as AppointmentMedium)) return { ok: false, error: "Choose an available appointment option." }
                update.meeting_medium = value
                if (value === "phone") update.meeting_link = null
            } else if (field === "meeting_link") {
                const cleaned = cleanMeetingLink(value)
                if (cleaned === null) return { ok: false, error: "Add a valid HTTPS meeting link." }
                update.meeting_link = cleaned || null
            } else if (field.startsWith("detail:")) {
                const key = field.slice("detail:".length) as AppointmentFieldKey
                const requested = configuration.fields.find((candidate) => candidate.key === key)
                if (!requested) return { ok: false, error: "That field is not configured for this client." }
                const cleaned = normalizeDetail(key, value)
                const label = APPOINTMENT_FIELD_OPTIONS.find((option) => option.key === key)?.label ?? "This field"
                if (cleaned === null) return { ok: false, error: key === "phone" ? "Add a valid 10-digit US phone number." : `Add a valid ${label.toLowerCase()}.` }
                if (key === "phone") update.phone = cleaned || null
                else {
                    const details = { ...((update.details ?? current.details ?? {}) as Record<string, string>) }
                    if (cleaned) details[key] = cleaned
                    else delete details[key]
                    update.details = details
                }
            } else return { ok: false, error: "That appointment field cannot be edited." }
            return { ok: true }
        })()
        if (!result.ok) return { ...result, fieldErrors: { [field]: result.error } }
    }
    if (update.meeting_medium === "phone") update.meeting_link = null

    if (command) return commit()
    const { data, error } = await supabaseAdmin.from("appointment_setting_appointments").update(update).eq("updated_at", expectedUpdatedAt).eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("service_id", serviceId).eq("id", appointmentId).eq("workflow_status", "draft").select(APPOINTMENT_SELECT).maybeSingle()
    if (error || !data) {
        console.error("Appointment Setting draft could not be updated", { workspaceId: workspace.id, relationshipId, appointmentId, code: error?.code })
        return { ok: false, conflict: !error, error: !error ? "This draft changed. Review its latest details and try again." : "We couldn't save that draft change. Try again." }
    }
    return { ok: true, data: data as AppointmentSettingAppointment }
}

export async function submitAppointmentSettingAppointment(workspaceSlug: string, relationshipId: string, appointmentId: string, expectedUpdatedAt: string, options: { expectedUserId?: string; revalidate?: boolean } = {}): Promise<WorkspaceMutationResult<AppointmentSubmission>> {
    const { workspace, user, relationship, serviceId, configuration } = await requireAppointmentSettingContext(workspaceSlug, relationshipId)
    if (options.expectedUserId && options.expectedUserId !== user.id) return { ok: false, error: "Your account changed. Reopen this appointment with the original account before submitting." }
    const { data: current } = await supabaseAdmin.from("appointment_setting_appointments").select(APPOINTMENT_SELECT).eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("service_id", serviceId).eq("id", appointmentId).maybeSingle()
    if (!current) return { ok: false, error: "That appointment draft is no longer available." }
    if (current.workflow_status !== "draft") {
        if (!current.submission_message_id) return { ok: false, error: "That appointment has already been submitted." }
        const message = await supabaseAdmin.from("client_messages").select("status, error").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("id", current.submission_message_id).maybeSingle()
        if (message.error || !message.data) throw new Error("Could not confirm the existing appointment submission.")
        return { ok: true, data: { appointment: current as AppointmentSettingAppointment, notificationStatus: appointmentNotificationStatus(message.data.status), notificationError: message.data.error } }
    }
    if (current.updated_at !== expectedUpdatedAt) return { ok: false, conflict: true, error: "This draft changed. Review its latest details before submitting." }
    const appointment = current as AppointmentSettingAppointment
    const validated = validateSubmission(appointment, configuration)
    if (!validated.ok) return validated

    let resolved: Awaited<ReturnType<typeof resolveCommunicationDestinations>>
    try {
        resolved = await resolveCommunicationDestinations({ workspaceId: workspace.id, relationshipId })
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "The client does not have an available Communications destination." }
    }
    const primaryDestination = resolved.destinations.find((destination) => destination.primary) ?? resolved.destinations[0]
    if (!primaryDestination) return { ok: false, error: "Connect a client SMS or WhatsApp destination before submitting." }
    const body = formatAppointmentNotification({
        clientPortalUrl: await getClientPortalUrlForOnboardingSession({ workspaceId: workspace.id, relationshipId }),
        contactName: validated.value.contactName,
        appointmentDate: validated.value.appointmentDate,
        appointmentTime: validated.value.appointmentTime,
        appointmentTimezone: validated.value.appointmentTimezone,
        meetingMedium: appointment.meeting_medium,
        meetingLink: validated.value.meetingLink,
    })
    const provider = resolved.destinations.length > 1 ? "omnichannel" : primaryDestination.provider
    const queuedDelivery = process.env.WORKSPACE_APPOINTMENT_OUTBOX_READY === "1" && workspaceNativePanelsEnabled(workspace.id, process.env.WORKSPACE_NATIVE_PANELS)
    const { data: submission, error: submissionError } = await supabaseAdmin.rpc(queuedDelivery ? "submit_appointment_setting_appointment_queued" : "submit_appointment_setting_appointment", {
        p_workspace_id: workspace.id,
        p_relationship_id: relationshipId,
        p_service_id: serviceId,
        p_appointment_id: appointmentId,
        p_user_id: user.id,
        p_expected_updated_at: expectedUpdatedAt,
        p_communication_channel_id: primaryDestination.channelId,
        p_provider: provider,
        p_to_address: primaryDestination.address,
        p_body: body,
    })
    const receipt = submission as { message_id?: string; appointment?: AppointmentSettingAppointment; already_submitted?: boolean; outbox_id?: string } | null
    if (submissionError || !receipt?.message_id || !receipt.appointment) {
        console.error("Appointment Setting draft could not be submitted", { workspaceId: workspace.id, relationshipId, appointmentId, code: submissionError?.code })
        const error = submissionError?.code === "40001"
            ? "This draft changed. Review its latest details before submitting."
            : submissionError?.code === "23514"
                ? submissionError.message
                : "We couldn't submit this appointment. Try again."
        return { ok: false, error }
    }
    const messageId = receipt.message_id
    const submittedRow = receipt.appointment
    if (queuedDelivery && receipt.outbox_id) {
        const outboxId = receipt.outbox_id
        // This only accelerates an already durable job. The authenticated cron
        // remains responsible if the response/process ends before it runs.
        after(async () => {
            try { await processAppointmentNotificationOutbox({ outboxId, limit: 1 }) }
            catch { console.error("Appointment notification worker needs recovery", { outboxId }) }
        })
        if (options.revalidate !== false) revalidatePath(detailPath(workspaceSlug, relationshipId))
        return { ok: true, data: { appointment: submittedRow, notificationStatus: "pending", notificationError: null } }
    }
    let notificationStatus: AppointmentNotificationStatus = "uncertain"
    let notificationError: string | null = null
    try {
        const outcome = await deliverAppointmentSubmission({
            alreadySubmitted: receipt.already_submitted === true,
            send: () => sendCommunicationDeliveries({ workspaceId: workspace.id, relationshipId, messageId, body, destinations: resolved.destinations }),
            read: async () => {
                const { data, error } = await supabaseAdmin.from("client_messages").select("status, error").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("id", messageId).single()
                if (error) throw new Error(error.message)
                return data
            },
        })
        notificationStatus = outcome.notificationStatus
        notificationError = outcome.notificationError
    } catch (error) {
        notificationError = error instanceof Error ? error.message : "Client notification delivery could not be confirmed."
        // A provider may have accepted a send before persistence failed. Keep an
        // uncertain result, and never overwrite the owning request on a replay.
        if (!receipt.already_submitted) {
            await supabaseAdmin.from("client_messages").update({ status: "send_uncertain", error: notificationError }).eq("workspace_id", workspace.id).eq("id", messageId).eq("status", "sending")
        }
    }

    if (relationship.client_id && !receipt.already_submitted) {
        await recordClientAdminActivity({
            clientId: relationship.client_id,
            category: "communications",
            level: notificationStatus === "sent" ? "info" : "warning",
            eventKey: "appointment.submitted",
            summary: notificationStatus === "sent" ? "Appointment submitted and client notified" : "Appointment submitted; client notification needs review",
            entityType: "appointment_setting_appointment",
            entityId: appointmentId,
            actorUserId: user.id,
            actorKind: "staff",
            direction: "outbound",
            metadata: { relationship_id: relationshipId, message_id: messageId, notification_status: notificationStatus },
        }).catch(() => undefined)
    }
    if (options.revalidate !== false) revalidatePath(detailPath(workspaceSlug, relationshipId))
    return { ok: true, data: { appointment: submittedRow as AppointmentSettingAppointment, notificationStatus, notificationError } }
}

export async function deleteAppointmentSettingAppointment(workspaceSlug: string, relationshipId: string, appointmentId: string): Promise<WorkspaceMutationResult> {
    const { workspace, serviceId } = await requireAppointmentSettingContext(workspaceSlug, relationshipId)
    const { data, error } = await supabaseAdmin.from("appointment_setting_appointments").delete().eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("service_id", serviceId).eq("id", appointmentId).eq("workflow_status", "draft").select("id").maybeSingle()
    if (error || !data) {
        console.error("Appointment Setting draft could not be deleted", { workspaceId: workspace.id, relationshipId, appointmentId, code: error?.code })
        return { ok: false, error: "We couldn't remove this draft. Submitted appointments cannot be removed here." }
    }
    revalidatePath(detailPath(workspaceSlug, relationshipId))
    return { ok: true }
}
