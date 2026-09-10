import "server-only"

import { recordClientAdminActivity } from "@/lib/admin/activity"
import { formatAppointmentNotification, type AppointmentSettingAppointment } from "@/lib/appointment-setting"
import { getClientPortalUrlForOnboardingSession } from "@/lib/client-portal/session"
import { resolveCommunicationDestinations, sendCommunicationDeliveries } from "@/lib/client-messages/omnichannel"
import { sanitizeOnboardingOutboxError } from "@/lib/onboarding/outbox-safety"
import { supabaseAdmin } from "@/lib/supabase/admin"

type Job = { id: string; workspace_id: string; relationship_id: string; appointment_id: string; message_id: string; actor_user_id: string | null; lease_token: string }

async function finish(job: Job, status: string | null, error: unknown) {
    const summary = error ? sanitizeOnboardingOutboxError(error) : null
    const result = await supabaseAdmin.rpc("finish_appointment_notification_outbox", {
        p_outbox_id: job.id, p_lease_token: job.lease_token, p_message_status: status, p_error_summary: summary,
    })
    if (result.error) throw new Error("Could not persist appointment notification outcome.")
    return result.data === true
}

async function processJob(job: Job) {
    try {
        const [workspace, appointment, message, channels] = await Promise.all([
            supabaseAdmin.from("workspaces").select("status").eq("id", job.workspace_id).maybeSingle(),
            supabaseAdmin.from("appointment_setting_appointments").select("id, contact_name, appointment_date, appointment_time, appointment_timezone, meeting_medium, meeting_link, workflow_status, submission_message_id")
                .eq("workspace_id", job.workspace_id).eq("relationship_id", job.relationship_id).eq("id", job.appointment_id).maybeSingle(),
            supabaseAdmin.from("client_messages").select("status").eq("workspace_id", job.workspace_id).eq("relationship_id", job.relationship_id).eq("id", job.message_id).maybeSingle(),
            // Current channel ownership and portal handoff are resolved again;
            // sendCommunicationDeliveries also rechecks SMS consent at dispatch.
            resolveCommunicationDestinations({ workspaceId: job.workspace_id, relationshipId: job.relationship_id }),
        ])
        if (workspace.error || appointment.error || message.error) throw new Error("Could not verify appointment delivery context.")
        if (workspace.data?.status !== "active" || !appointment.data || appointment.data.workflow_status !== "submitted" || appointment.data.submission_message_id !== job.message_id || !message.data) throw new Error("This appointment notification is no longer available for delivery.")
        if (["sent", "delivered", "read"].includes(message.data.status)) { await finish(job, message.data.status, null); return "sent" as const }
        if (message.data.status !== "sending") { await finish(job, message.data.status, "Review the existing notification outcome before retrying."); return "attention" as const }
        if (!channels.destinations.length) throw new Error("This client no longer has an available messaging destination.")
        const row = appointment.data as AppointmentSettingAppointment
        // The submitted appointment is immutable. Rebuild its automation text
        // using the current portal link; no encrypted read permission is added
        // to the service role and no body is copied into the outbox table.
        const body = formatAppointmentNotification({
            clientPortalUrl: await getClientPortalUrlForOnboardingSession({ workspaceId: job.workspace_id, relationshipId: job.relationship_id }),
            contactName: row.contact_name!, appointmentDate: row.appointment_date!, appointmentTime: row.appointment_time!,
            appointmentTimezone: row.appointment_timezone, meetingMedium: row.meeting_medium, meetingLink: row.meeting_link,
        })
        const dispatch = await supabaseAdmin.rpc("prepare_appointment_notification_dispatch", { p_outbox_id: job.id, p_lease_token: job.lease_token, p_body: body })
        if (dispatch.error) throw new Error("The delivery dispatch acknowledgement could not be confirmed.")
        if (dispatch.data !== true) return "superseded" as const
        const outcome = await sendCommunicationDeliveries({ workspaceId: job.workspace_id, relationshipId: job.relationship_id, messageId: job.message_id, body, destinations: channels.destinations })
        await finish(job, outcome.status, outcome.error)
        if (channels.relationship.client_id) {
            await recordClientAdminActivity({
                clientId: channels.relationship.client_id, category: "communications", eventKey: "appointment.notification.completed",
                summary: outcome.status === "sent" ? "Appointment client notification sent" : "Appointment client notification needs review",
                level: outcome.status === "sent" ? "info" : "warning", entityType: "appointment_setting_appointment", entityId: job.appointment_id,
                actorUserId: job.actor_user_id, actorKind: "automation", direction: "outbound",
                metadata: { relationship_id: job.relationship_id, message_id: job.message_id, notification_status: outcome.status },
            }).catch(() => undefined)
        }
        return outcome.status === "sent" ? "sent" as const : "attention" as const
    } catch (error) {
        // SQL decides whether dispatch might have happened, even if its
        // acknowledgement was lost. Unknown sends are never auto-retried.
        await finish(job, null, error)
        return "attention" as const
    }
}

export async function processAppointmentNotificationOutbox(input: { outboxId?: string; limit?: number } = {}) {
    const claimed = await supabaseAdmin.rpc("claim_appointment_notification_outbox", { p_limit: Math.min(25, Math.max(1, input.limit ?? 5)), p_outbox_id: input.outboxId ?? null })
    if (claimed.error) throw new Error("Could not claim appointment notification jobs.")
    const jobs = (claimed.data ?? []) as Job[]
    const outcomes = await Promise.allSettled(jobs.map(processJob))
    return {
        claimed: jobs.length,
        sent: outcomes.filter((outcome) => outcome.status === "fulfilled" && outcome.value === "sent").length,
        attention: outcomes.filter((outcome) => outcome.status === "fulfilled" && outcome.value === "attention").length,
        failed: outcomes.filter((outcome) => outcome.status === "rejected").length,
    }
}
