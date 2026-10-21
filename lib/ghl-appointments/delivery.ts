import { createHash } from "node:crypto"
import { profileIncludesCalendar, type AppointmentSnapshot, type ProviderProfile } from "./types"
import { appointmentSnapshotsEqual } from "./lifecycle"
import { appointmentTemplateComponents, appointmentTemplateContracts, validateAppointmentTemplate, type AppointmentTemplateKind } from "./templates"

export type AutomationProfile = {
    id: string
    workspaceId: string
    relationshipId: string
    locationId: string
    calendarId: string
    calendarName: string
    calendars?: { id: string; name: string }[]
    connectionRevision: string
    detectionEnabled: boolean
    sendingEnabled: boolean
    portalOrigin: string
    reminderMinutes: number
    timezone?: string
    includeNotes?: boolean
}
export type NotificationJob = {
    id: string
    leaseToken: string
    kind: AppointmentTemplateKind
    snapshot: AppointmentSnapshot
    previousSnapshot: AppointmentSnapshot | null
    changedDetails?: string
    summaryToken: string
    profile: AutomationProfile
    recordedAt: string
}
/** A returned SQL refusal is definite; a transport exception may hide a commit. */
export class GhlAutomationRejected extends Error {
    action: string
    code: string
    constructor(action: string, code: string) {
        super(`GHL automation ${action} was refused.`)
        this.name = "GhlAutomationRejected"
        this.action = action
        this.code = code
    }
}
export type AutomationRpc = (action: string, input: Record<string, unknown>) => Promise<unknown>
export type DeliveryDependencies = {
    rpc: AutomationRpc
    now: () => Date
    sendingEnabled: () => boolean
    fetchAppointment: (profile: ProviderProfile, id: string) => Promise<AppointmentSnapshot | null>
    liveTemplate: (workspaceId: string, kind: AppointmentTemplateKind) => Promise<unknown>
    sendTemplate: (input: { workspaceId: string; to: string; templateName: string; languageCode: string; components: unknown[]; callbackData: string }) => Promise<unknown>
}

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function formatAppointmentInstant(value: string, timezone: string) {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime()) || !timezone) throw new Error("Appointment timezone or timestamp is unavailable.")
    return new Intl.DateTimeFormat("en-US", {
        timeZone: timezone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "shortOffset",
    }).format(date)
}
function schedule(snapshot: AppointmentSnapshot) {
    return `${formatAppointmentInstant(snapshot.startTime, snapshot.timezone)} – ${formatAppointmentInstant(snapshot.endTime, snapshot.timezone)}`
}

export function notificationValues(job: NotificationJob, now: Date): Record<string, string> {
    const current = job.snapshot
    const previous = job.previousSnapshot
    if ((job.kind === "rescheduled" || job.kind === "status_updated") && !previous) throw new Error("The previous appointment version is unavailable.")
    const recorded = formatAppointmentInstant(job.recordedAt || current.observedAt, current.timezone)
    return {
        calendar_name: current.calendarName,
        contact_name: current.contactName,
        appointment_name: current.title,
        schedule: schedule(current),
        status: current.status,
        contact_details: current.contactDetails || "Not supplied",
        meeting_details: current.meetingDetails || "Not supplied",
        booking_details: current.bookingDetails || "Not supplied",
        update_recorded_at: recorded,
        change_recorded_at: recorded,
        reminder_generated_at: formatAppointmentInstant(now.toISOString(), current.timezone),
        previous_schedule: schedule(previous ?? current),
        current_schedule: schedule(current),
        previous_status: previous?.status ?? "",
        current_status: current.status,
        changed_details: job.changedDetails ?? "",
    }
}

function externalMessageId(value: unknown) {
    const messages = record(value).messages
    const id = Array.isArray(messages) ? record(messages[0]).id : null
    return typeof id === "string" && id.length > 0 && id.length <= 512 ? id : null
}

function sameVisibleState(job: NotificationJob, live: AppointmentSnapshot | null) {
    if (job.kind === "removed") return live === null || live.deleted || !profileIncludesCalendar(job.profile, live.calendarId)
    return live !== null && profileIncludesCalendar(job.profile, live.calendarId) && appointmentSnapshotsEqual(job.snapshot, live)
}

/** Each async preflight happens before the durable send boundary. Unknown sends never retry. */
export async function deliverAppointmentNotification(job: NotificationJob, deps: DeliveryDependencies) {
    // Checked before credential reads, template lookups, or dispatch preparation.
    if (!deps.sendingEnabled() || job.profile.sendingEnabled !== true) return "disabled" as const
    const finishPreflight = async (outcome: "blocked" | "superseded", error: string) => {
        await deps.rpc("finish_notification", { id: job.id, leaseToken: job.leaseToken, outcome, error, retryAfterSeconds: 300 })
        return outcome
    }
    let dispatchMayHaveStarted = false
    try {
        const context = record(await deps.rpc("notification_context", { id: job.id, leaseToken: job.leaseToken }))
        if (!context.profile || typeof context.privateToken !== "string" || typeof context.destination !== "string") {
            return await finishPreflight("blocked", "Appointment delivery context is unavailable.")
        }
        const profile = context.profile as AutomationProfile
        if (!profile.sendingEnabled || !profile.detectionEnabled || profile.portalOrigin !== "https://portal.scaylup.com") {
            return await finishPreflight("blocked", "Appointment sending or portal access is disabled.")
        }
        const provider: ProviderProfile = { ...profile, privateToken: context.privateToken }
        // Refetch even for a queued cancellation/removal; old notices must not
        // overtake a restore/reschedule which has not reached our inbox yet.
        const live = await deps.fetchAppointment(provider, job.snapshot.id)
        if (!sameVisibleState(job, live)) {
            const refreshed = record(await deps.rpc("ingest", {
                locationId: profile.locationId, calendarId: profile.calendarId, appointmentId: job.snapshot.id,
                eventType: live ? "AppointmentUpdate" : "AppointmentDelete",
                eventKey: `dispatch-refresh:${job.id}`, payloadHash: createHash("sha256").update(`dispatch-refresh:${job.id}`).digest("hex"),
                payload: { source: "dispatch_verification" }, occurredAt: deps.now().toISOString(),
            }))
            if (refreshed.accepted !== true) throw new Error("Appointment refresh was not durably accepted.")
            return await finishPreflight("superseded", "Appointment changed before delivery; refreshing its retained version.")
        }
        const now = deps.now()
        if (job.kind === "reminder" && (!live || live.deleted || !["new", "confirmed"].includes(live.status.toLowerCase()) || Date.parse(live.startTime) <= now.getTime()
            || now.getTime() < Date.parse(live.startTime) - profile.reminderMinutes * 60_000)) {
            return await finishPreflight("superseded", "The appointment is no longer eligible for this reminder.")
        }
        validateAppointmentTemplate(await deps.liveTemplate(profile.workspaceId, job.kind), job.kind)
        const template = appointmentTemplateComponents(job.kind, notificationValues(job, now), job.summaryToken)
        // Recheck the process kill switch at the actual dispatch boundary. SQL
        // independently rechecks profile, connection, version, consent and STOP.
        if (!deps.sendingEnabled()) return await finishPreflight("blocked", "Appointment sending is disabled.")
        dispatchMayHaveStarted = true
        const prepared = record(await deps.rpc("begin_dispatch", {
            id: job.id, leaseToken: job.leaseToken, body: template.body, destination: context.destination,
            templateName: template.name, templateLanguage: template.language,
            templateStatus: "APPROVED", templateCategory: "UTILITY", templateVerifiedAt: deps.now().toISOString(),
        }))
        if (typeof prepared.messageId !== "string" || typeof prepared.destination !== "string") throw new Error("Dispatch preparation acknowledgement was incomplete.")
        const response = await deps.sendTemplate({
            workspaceId: profile.workspaceId, to: prepared.destination, templateName: template.name,
            languageCode: template.language, components: template.components, callbackData: prepared.messageId,
        })
        const providerMessageId = externalMessageId(response)
        if (!providerMessageId) throw new Error("Meta acknowledgement had no message identifier.")
        await deps.rpc("finish_dispatch", { id: job.id, leaseToken: job.leaseToken, outcome: "accepted", providerMessageId })
        return "accepted" as const
    } catch (error) {
        if (error instanceof GhlAutomationRejected && error.action === "begin_dispatch") dispatchMayHaveStarted = false
        if (error instanceof GhlAutomationRejected && ["begin_dispatch", "notification_context"].includes(error.action) && error.code === "superseded") {
            return await finishPreflight("superseded", "This appointment notice has expired or was superseded.")
        }
        // Include neither provider content nor tokens in durable diagnostics.
        // All errors after begin (including lost DB ack) are quarantined. A
        // provider-side reject may be manually reviewed, never blindly resent.
        if (dispatchMayHaveStarted) {
            await deps.rpc("finish_dispatch", {
                id: job.id, leaseToken: job.leaseToken, outcome: "uncertain", error: "Delivery acknowledgement requires review; automatic retry is disabled.",
            })
            return "uncertain" as const
        }
        return await finishPreflight("blocked", "Appointment, consent or approved template verification failed.")
    }
}

export async function readLiveAppointmentTemplate(workspaceId: string, kind: AppointmentTemplateKind) {
    const [{ getWorkspaceProviderConfig }, { readGhlJson }] = await Promise.all([import("@/lib/workspace-integrations"), import("../client-portal/ghl-provider")])
    const config = await getWorkspaceProviderConfig(workspaceId, "meta_whatsapp")
    // These seven approved identities belong to one submitted WABA. Another
    // workspace cannot accidentally reuse their names against its own account.
    if (config.waba_id !== "1928719317836909") throw new Error("Appointment templates belong to a different WhatsApp business account.")
    const fields = "id,name,language,status,category,parameter_format,components,message_send_ttl_seconds"
    const response = await fetch(`https://graph.facebook.com/v25.0/${appointmentTemplateContracts[kind].id}?fields=${fields}`, {
        headers: { Authorization: `Bearer ${config.access_token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) { await response.body?.cancel(); throw new Error("Appointment template status could not be verified.") }
    return readGhlJson(response, 65_536)
}
