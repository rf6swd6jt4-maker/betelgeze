import type { CalendarObservation } from "./provider"
import { createHash } from "node:crypto"
import { profileCalendars, profileIncludesCalendar, type AppointmentSnapshot, type ProviderProfile } from "./types"
import { classifyAppointmentChange, reminderDueAt } from "./lifecycle"
import { deliverAppointmentNotification, readLiveAppointmentTemplate, GhlAutomationRejected, type AutomationProfile, type AutomationRpc, type DeliveryDependencies, type NotificationJob } from "./delivery"

type EventJob = { id: string; leaseToken: string; appointmentId: string; eventType: string; occurredAt?: string; payload?: Record<string, unknown> }
type CurrentAppointment = { version: number; snapshot: AppointmentSnapshot }
type EventContext = { profile: AutomationProfile; current: CurrentAppointment | null; privateToken: string }
type ReconciliationJob = { profile: AutomationProfile; leaseToken: string; privateToken: string; cursor?: unknown }
type ReconcileCursor = {
    version: 1
    phase: "window" | "known"
    windowStart: string
    horizonEnd: string
    baseline: boolean
    cycleId: string
    windowAfter?: string | null
    knownAfter?: string | null
    calendarIndex?: number
    knownCycleId: string
}
export type AppointmentWorkerDependencies = {
    refreshPortalCalendar?: () => Promise<unknown>
    enrichAppointmentNotes?: () => Promise<unknown>
    fetchCalendarChanges?: (profile: ProviderProfile, window: { start: string; end: string }) => Promise<CalendarObservation[]>
    rpc: AutomationRpc
    now: () => Date
    detectionEnabled: () => boolean
    delivery: DeliveryDependencies
    fetchAppointment: (profile: ProviderProfile, id: string) => Promise<AppointmentSnapshot | null>
    fetchCalendarWindow: (profile: ProviderProfile, window: { start: string; end: string }) => Promise<{ appointmentIds: string[]; complete: true }>
}

const DAY = 86_400_000
function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function items<T>(value: unknown): T[] { const rows = record(value).items; return Array.isArray(rows) ? rows as T[] : [] }
function fingerprint(value: string) { return createHash("sha256").update(value).digest("hex") }
function providerProfile(context: { profile: AutomationProfile; privateToken: string }): ProviderProfile { return { ...context.profile, privateToken: context.privateToken } }

export async function processGhlEvent(job: EventJob, deps: AppointmentWorkerDependencies) {
    try {
        const result = await deps.rpc("event_context", { id: job.id, leaseToken: job.leaseToken })
        const context = result as EventContext | null
        if (!context?.profile || !context.privateToken || !(context.profile.detectionEnabled || context.profile.portalSyncEnabled)) throw new Error("event_context_unavailable")
        const live = await deps.fetchAppointment(providerProfile(context), job.appointmentId)
        const previous = context.current?.snapshot ?? null
        let snapshot: AppointmentSnapshot
        if (!live || !profileIncludesCalendar(context.profile, live.calendarId)) {
            // Never use a failed lookup/list omission as proof of removal. The
            // provider returns null only for authenticated exact-ID absence or
            // an explicit deleted flag after verifying its ID and location.
            if (!previous) {
                await deps.rpc("fail_event", { id: job.id, leaseToken: job.leaseToken, error: "No retained appointment exists for the confirmed removal.", retryable: false })
                return "attention" as const
            }
            snapshot = { ...previous, deleted: true, observedAt: deps.now().toISOString(), sourceUpdatedAt: live?.sourceUpdatedAt ?? null }
        } else {
            snapshot = live
        }
        const cutoff = typeof job.payload?.baselineBefore === "string" ? Date.parse(job.payload.baselineBefore) : NaN
        const created = snapshot.sourceCreatedAt ? Date.parse(snapshot.sourceCreatedAt) : NaN
        const baseline = job.payload?.baseline === true && !(Number.isFinite(cutoff) && Number.isFinite(created) && created >= cutoff)
        const change = classifyAppointmentChange(previous, snapshot, { baseline, eventType: job.eventType })
        const outcome = record(await deps.rpc("apply_event", {
            id: job.id, leaseToken: job.leaseToken, expectedVersion: context.current?.version ?? 0,
            snapshot, sourceUpdatedAt: snapshot.sourceUpdatedAt, kinds: change.kinds, changedDetails: change.changedDetails,
            reminderAt: reminderDueAt(snapshot, context.profile.reminderMinutes, deps.now()),
        }))
        if (outcome.ignored === true) return "superseded" as const
        if (outcome.applied !== true) throw new Error("Appointment update was not durably accepted.")
        return "applied" as const
    } catch (error) {
        const category = error instanceof GhlAutomationRejected ? `database_${error.code}` : ["response", "location", "timezone", "permissions", "credentials", "rate_limit", "unavailable"].includes(String((error as { code?: string })?.code)) ? String((error as { code: string }).code) : "processing"
        await deps.rpc("fail_event", { id: job.id, leaseToken: job.leaseToken, error: `Appointment verification failed: ${category}.`, retryable: true })
        return "attention" as const
    }
}

export function nextReconcileCursor(value: unknown, now: Date): ReconcileCursor {
    const input = record(value)
    if (input.version === 1 && ["window", "known"].includes(String(input.phase)) && typeof input.windowStart === "string" && typeof input.horizonEnd === "string"
        && Number.isFinite(Date.parse(input.windowStart)) && Number.isFinite(Date.parse(input.horizonEnd))
        && Date.parse(input.horizonEnd) >= Date.parse(input.windowStart) && Date.parse(input.horizonEnd) - Date.parse(input.windowStart) <= 98 * DAY
        && typeof input.baseline === "boolean") {
        if (typeof input.cycleId !== "string" || input.cycleId.length > 64 || (input.windowAfter != null && (typeof input.windowAfter !== "string" || input.windowAfter.length > 200))) throw new Error("Invalid reconciliation cursor.")
        return { ...input, calendarIndex: Number.isInteger(input.calendarIndex) && Number(input.calendarIndex) >= 0 && Number(input.calendarIndex) < 10 ? Number(input.calendarIndex) : 0, knownCycleId: typeof input.knownCycleId === "string" ? input.knownCycleId : input.cycleId } as ReconcileCursor
    }
    // First scan establishes a baseline without announcing old bookings as new.
    const start = new Date(now.getTime() - 7 * DAY); start.setUTCHours(0, 0, 0, 0)
    return { version: 1, phase: "window", windowStart: start.toISOString(), horizonEnd: new Date(start.getTime() + 97 * DAY).toISOString(), baseline: true, cycleId: now.toISOString(), knownCycleId: now.toISOString() }
}

async function queueObservation(deps: AppointmentWorkerDependencies, profile: AutomationProfile, appointmentId: string, key: string, baseline: boolean) {
    const accepted = record(await deps.rpc("ingest", {
        locationId: profile.locationId, calendarId: profile.calendarId, appointmentId, eventType: "AppointmentUpdate",
        eventKey: key, payloadHash: fingerprint(key), payload: { source: "reconciliation", baseline, baselineBefore: profile.sendingActivatedAt ?? profile.createdAt }, occurredAt: deps.now().toISOString(),
    }))
    if (accepted.accepted !== true) throw new Error("Reconciliation observation was not durably accepted.")
}

export async function discoverRecentChanges(job: ReconciliationJob, deps: AppointmentWorkerDependencies) {
    if (!deps.fetchCalendarChanges) return
    const start = new Date(deps.now().getTime() - 7 * DAY); start.setUTCHours(0, 0, 0, 0)
    const window = { start: start.toISOString(), end: new Date(start.getTime() + 97 * DAY).toISOString() }
    const calendars = profileCalendars(job.profile)
    // Reuse the durable rotation so a busy first calendar cannot starve others.
    const offset = (nextReconcileCursor(job.cursor, deps.now()).calendarIndex ?? 0) % calendars.length
    const deadline = Date.now() + 45_000
    let budget = 5
    for (let i = 0; i < calendars.length && budget > 0; i++) {
        if (Date.now() >= deadline) throw new Error("Discovery deadline reached.")
        const calendar = calendars[(offset + i) % calendars.length]
        const profile = { ...job.profile, calendarId: calendar.id, calendarName: calendar.name }
        const observations = await deps.fetchCalendarChanges(providerProfile({ ...job, profile }), window)
        const result = record(await deps.rpc("reconciliation_changes", { profileId: profile.id, leaseToken: job.leaseToken, calendarId: calendar.id, observations, limit: budget }))
        for (const candidate of items<{ id: string; version: number }>(result)) {
            const observation = observations.find(item => item.id === candidate.id)!
            const key = `reconcile-fast:${fingerprint(JSON.stringify([profile.id, profile.connectionRevision, candidate.version, observation]))}`
            const accepted = record(await deps.rpc("ingest", { locationId: profile.locationId, calendarId: calendar.id, appointmentId: candidate.id, eventType: "AppointmentUpdate", eventKey: key, payloadHash: fingerprint(key),
                payload: { source: "reconciliation", baseline: true, baselineBefore: profile.sendingActivatedAt ?? profile.createdAt ?? deps.now().toISOString() }, occurredAt: deps.now().toISOString() }))
            if (accepted.accepted !== true) throw new Error("Discovery was not retained.")
            budget--
        }
    }
}

/** One bounded page per profile. Missing list rows never cause deletions. */
export async function reconcileGhlProfile(job: ReconciliationJob, deps: AppointmentWorkerDependencies, discoveryWarning: string | null = null) {
    let cursor: ReconcileCursor | null = null
    try {
        cursor = nextReconcileCursor(job.cursor, deps.now())
        const profile = job.profile
        if (!(profile?.detectionEnabled || profile?.portalSyncEnabled) || !job.privateToken) throw new Error("Reconciliation context is unavailable.")
        if (cursor.phase === "window") {
            const end = new Date(Math.min(Date.parse(cursor.windowStart) + DAY, Date.parse(cursor.horizonEnd))).toISOString()
            // Re-read this bounded one-day list and advance by provider ID.
            // The durable cursor remains small even for a busy calendar.
            const calendars = profileCalendars(profile), calendarIndex = (cursor.calendarIndex ?? 0) % calendars.length
            const calendar = calendars[calendarIndex]
            const selectedProfile = { ...profile, calendarId: calendar.id, calendarName: calendar.name }
            const listed = await deps.fetchCalendarWindow(providerProfile({ ...job, profile: selectedProfile }), { start: cursor.windowStart, end })
            if (!listed.complete || listed.appointmentIds.length > 1000) throw new Error("Incomplete calendar response.")
            const remaining = [...new Set(listed.appointmentIds)].sort().filter((id) => id > (cursor!.windowAfter ?? ""))
            const page = remaining.slice(0, 10)
            for (const id of page) {
                const key = `reconcile:${fingerprint(`${profile.id}:${calendar.id}:${cursor.cycleId}:${cursor.windowStart}:${id}`)}`
                await queueObservation(deps, selectedProfile, id, key, cursor.baseline)
            }
            if (remaining.length > page.length) cursor.windowAfter = page[page.length - 1]
            else {
                delete cursor.windowAfter
                cursor.calendarIndex = (calendarIndex + 1) % calendars.length
                if (cursor.calendarIndex === 0) cursor.windowStart = end
                if (cursor.calendarIndex === 0 && Date.parse(end) >= Date.parse(cursor.horizonEnd)) {
                    const knownAfter = cursor.knownAfter, knownCycleId = cursor.knownCycleId
                    cursor = { ...nextReconcileCursor(null, deps.now()), baseline: false, knownAfter, knownCycleId }
                }
            }
            cursor.phase = "known"
        } else {
            // Point-verify retained identities in addition to list discovery;
            // this recovers missed deletes and moves even outside the horizon.
            const page = record(await deps.rpc("reconciliation_candidates", { profileId: profile.id, leaseToken: job.leaseToken, afterId: cursor.knownAfter ?? null, limit: 10 }))
            for (const candidate of items<{ appointmentId: string }>(page)) {
                const key = `reconcile-known:${fingerprint(`${profile.id}:${cursor.knownCycleId}:${candidate.appointmentId}`)}`
                await queueObservation(deps, profile, candidate.appointmentId, key, cursor.baseline)
            }
            if (typeof page.nextCursor === "string") cursor.knownAfter = page.nextCursor
            else {
                cursor.knownAfter = null
                cursor.knownCycleId = new Date(Math.max(deps.now().getTime(), Date.parse(cursor.knownCycleId) + 1)).toISOString()
            }
            cursor.phase = "window"
        }
        await deps.rpc("finish_reconciliation", { profileId: profile.id, leaseToken: job.leaseToken, cursor, error: null, warning: discoveryWarning })
        return "reconciled" as const
    } catch {
        // Preserve the last durably saved cursor: retry the same page, using
        // deterministic event keys so a lost finish acknowledgement is harmless.
        await deps.rpc("finish_reconciliation", { profileId: job.profile.id, leaseToken: job.leaseToken, cursor: job.cursor ?? {}, error: "Calendar reconciliation could not be verified." })
        return "attention" as const
    }
}

export type AppointmentWake = { locationId: string; appointmentId?: string }
export async function runGhlAppointmentAutomation(deps: AppointmentWorkerDependencies, wake?: AppointmentWake) {
    const deliveryDeadline = Date.now() + 210_000
    if (!deps.detectionEnabled()) return { disabled: true, events: 0, reconciled: 0, accepted: 0, attention: 0, failed: 0 }
    const scope = wake ? { locationId: wake.locationId, ...(wake.appointmentId ? { appointmentId: wake.appointmentId } : {}) } : {}
    const events = items<EventJob>(await deps.rpc("claim_events", { limit: 5, ...scope }))
    const eventResults: PromiseSettledResult<Awaited<ReturnType<typeof processGhlEvent>>>[] = []
    // Sequential bounded work avoids provider bursts and preserves shared DB CPU.
    for (const event of events) eventResults.push(...await Promise.allSettled([processGhlEvent(event, deps)]))
    // A full intake batch applies backpressure to new reconciliation work.
    // Discovery cannot continually enqueue more work than this runner drains.
    const profiles = !wake && events.length < 5 ? items<ReconciliationJob>(await deps.rpc("claim_reconciliations", { limit: 1 })) : []
    const discoveryResults: PromiseSettledResult<void>[] = []
    for (const profile of profiles) discoveryResults.push(...await Promise.allSettled([discoverRecentChanges(profile, deps)]))
    const reconcileResults: PromiseSettledResult<Awaited<ReturnType<typeof reconcileGhlProfile>>>[] = []
    for (const [index, profile] of profiles.entries()) reconcileResults.push(...await Promise.allSettled([reconcileGhlProfile(profile, deps, discoveryResults[index]?.status === "rejected" ? "Fast calendar discovery failed; narrow recovery remains active." : null)]))
    // Drain observations discovered in this invocation instead of adding a cron delay.
    if (profiles.length && deps.fetchCalendarChanges) {
        const fresh = items<EventJob>(await deps.rpc("claim_events", { limit: 5 }))
        for (const event of fresh) eventResults.push(...await Promise.allSettled([processGhlEvent(event, deps)]))
    }
    if (!wake) await deps.rpc("enqueue_reminders", { limit: 20 })
    const deliveries: PromiseSettledResult<Awaited<ReturnType<typeof deliverAppointmentNotification>>>[] = []
    // No claiming/preparing messages while sending is off; detection still runs.
    if (deps.delivery.sendingEnabled()) {
        // Claim each delivery only when ready to process it, preserving its full lease.
        for (let count = 0; count < (wake ? 4 : 2); count++) {
            if (Date.now() >= deliveryDeadline) break
            const notifications = items<NotificationJob>(await deps.rpc("claim_notifications", { limit: 1, ...scope }))
            if (!notifications.length) break
            deliveries.push(...await Promise.allSettled([deliverAppointmentNotification(notifications[0], deps.delivery)]))
        }
    }
    // Optional calendar work runs after notification delivery and shares the
    // existing budget. Provider range reads cannot delay a ready notification.
    const portalResults = !wake && events.length < 5 && deps.refreshPortalCalendar && Date.now() < deliveryDeadline - 30_000
        ? await Promise.allSettled([deps.refreshPortalCalendar()]) : []
    const enrichmentResults = !wake && deps.enrichAppointmentNotes && Date.now() < deliveryDeadline - 30_000
        ? await Promise.allSettled([deps.enrichAppointmentNotes()]) : []
    const results = [...eventResults, ...reconcileResults, ...deliveries, ...discoveryResults, ...portalResults, ...enrichmentResults]
    return {
        disabled: false, events: eventResults.length,
        reconciled: reconcileResults.filter((result) => result.status === "fulfilled" && result.value === "reconciled").length,
        accepted: deliveries.filter((result) => result.status === "fulfilled" && result.value === "accepted").length,
        attention: results.filter((result) => result.status === "fulfilled" && (["attention", "uncertain", "blocked"].includes(String(result.value)) || record(result.value).attention === true)).length,
        failed: results.filter((result) => result.status === "rejected").length,
    }
}

export async function processGhlAppointmentAutomation(wake?: AppointmentWake) {
    if (process.env.GHL_APPOINTMENT_DETECTION_ENABLED !== "true") return { disabled: true, events: 0, reconciled: 0, accepted: 0, attention: 0, failed: 0 }
    const [{ supabaseAdmin }, provider, meta] = await Promise.all([
        import("@/lib/supabase/admin"), import("./provider"), import("@/lib/client-messages/meta-whatsapp"),
    ])
    const rpc: AutomationRpc = async (action, input) => {
        const result = await supabaseAdmin.rpc("ghl_appointment_automation", { p_action: action, p_input: { ...input, processorVersion: 2 } })
        if (result.error) throw new Error(`GHL automation ${action} could not be committed.`)
        const failure = record(result.data).failure
        if (typeof failure === "string") throw new GhlAutomationRejected(action, failure)
        return result.data
    }
    const now = () => new Date()
    const sendingEnabled = () => process.env.GHL_APPOINTMENT_SENDING_ENABLED === "true"
    const delivery: DeliveryDependencies = {
        rpc, now, sendingEnabled, fetchAppointment: provider.fetchAppointment, liveTemplate: readLiveAppointmentTemplate,
        sendTemplate: (input) => meta.sendMetaWhatsAppTemplate({ ...input, signal: AbortSignal.timeout(15_000), expectedWabaId: "1928719317836909" }),
    }
    const refreshPortalCalendar = async () => {
        const { refreshRequestedGhlCalendar } = await import("@/lib/client-portal/ghl-calendar-worker")
        return refreshRequestedGhlCalendar({ rpc: async (action, input) => {
            const result = await supabaseAdmin.rpc("ghl_portal_calendar_refresh", { p_action: action, p_input: input })
            if (result.error || record(result.data).failure) throw new Error("Calendar range work could not be committed.")
            return result.data
        } })
    }
    const enrichAppointmentNotes = async () => {
        const { processAppointmentNoteEnrichment } = await import("./notes")
        return processAppointmentNoteEnrichment({ rpc: params => supabaseAdmin.rpc("ghl_appointment_note_enrichment", params) })
    }
    return runGhlAppointmentAutomation({ rpc, now, detectionEnabled: () => process.env.GHL_APPOINTMENT_DETECTION_ENABLED === "true", delivery, refreshPortalCalendar, enrichAppointmentNotes,
        fetchAppointment: provider.fetchAppointment, fetchCalendarWindow: provider.fetchCalendarWindow, fetchCalendarChanges: provider.fetchCalendarChanges }, wake)
}
