import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import ts from "typescript"
import type { AppointmentSnapshot } from "../lib/ghl-appointments/types"
import type { AutomationProfile, NotificationJob, DeliveryDependencies } from "../lib/ghl-appointments/delivery"
import type { AppointmentWorkerDependencies } from "../lib/ghl-appointments/worker"

const require = createRequire(import.meta.url)
const loaded = new Map<string, Record<string, unknown>>()
function load(name: string): Record<string, unknown> {
    if (loaded.has(name)) return loaded.get(name)!
    const compiled = { exports: {} }
    const code = ts.transpileModule(readFileSync(`lib/ghl-appointments/${name}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("require", "module", "exports", code)((path: string) => path.startsWith("./") ? load(path.slice(2)) : require(path), compiled, compiled.exports)
    loaded.set(name, compiled.exports)
    return compiled.exports
}
const { appointmentTemplateContracts, validateAppointmentTemplate, appointmentTemplateComponents } = load("templates") as typeof import("../lib/ghl-appointments/templates")
const { deliverAppointmentNotification, notificationValues, formatAppointmentInstant, GhlAutomationRejected } = load("delivery") as typeof import("../lib/ghl-appointments/delivery")
const { runGhlAppointmentAutomation, processGhlAppointmentAutomation, processGhlEvent, reconcileGhlProfile, nextReconcileCursor } = load("worker") as typeof import("../lib/ghl-appointments/worker")
const now = new Date("2026-10-14T17:45:00Z")
const snapshot: AppointmentSnapshot = {
    id: "appointment1", locationId: "location1", calendarId: "calendar1", calendarName: "Consultations",
    contactId: "contact1", contactName: "Alex Morgan", title: "Window consultation", startTime: "2026-10-14T18:30:00Z", endTime: "2026-10-14T19:00:00Z",
    timezone: "America/New_York", status: "confirmed", contactDetails: "+1 202 555 0123; alex@example.com", meetingDetails: "Phone consultation", bookingDetails: "Six windows",
    sourceUpdatedAt: "2026-10-14T17:40:00Z", observedAt: now.toISOString(), deleted: false,
}
const profile: AutomationProfile = { id: "profile1", workspaceId: "workspace1", relationshipId: "relationship1", locationId: "location1", calendarId: "calendar1", calendarName: "Consultations", connectionRevision: "revision1", detectionEnabled: true, sendingEnabled: true, portalOrigin: "https://portal.scaylup.com", reminderMinutes: 60 }
const job: NotificationJob = { id: "job1", leaseToken: "lease1", kind: "added", snapshot, previousSnapshot: null, summaryToken: "a".repeat(64), profile, recordedAt: now.toISOString() }
function approved(kind: keyof typeof appointmentTemplateContracts = "added") {
    const contract = appointmentTemplateContracts[kind]
    return { id: contract.id, name: contract.name, language: contract.language, status: "APPROVED", category: "UTILITY", parameter_format: "POSITIONAL", message_send_ttl_seconds: contract.ttlSeconds,
        components: [{ type: "BODY", text: String(contract.body) }, { type: "BUTTONS", buttons: [{ type: "URL", text: "View appointment", url: "https://portal.scaylup.com/appointment/{{1}}" }] }] }
}
function deliveryFixture(overrides: Partial<DeliveryDependencies> = {}) {
    const calls: Array<{ action: string; input: Record<string, unknown> }> = []
    let sends = 0
    const deps: DeliveryDependencies = {
        rpc: async (action, input) => {
            calls.push({ action, input })
            if (action === "notification_context") return { profile, privateToken: "synthetic-private-token", destination: "+12025550123" }
            if (action === "begin_dispatch") return { messageId: "message1", deliveryId: "delivery1", destination: "+12025550123" }
            return { accepted: true }
        },
        now: () => now, sendingEnabled: () => true, fetchAppointment: async () => snapshot,
        liveTemplate: async (_w, kind) => approved(kind), sendTemplate: async (input) => { sends++; assert.equal(input.callbackData, "message1"); return { messages: [{ id: "wamid.synthetic" }] } }, ...overrides,
    }
    return { deps, calls, sends: () => sends }
}

test("all seven runtime contracts exactly match the submitted identities, text, variables, button and validity", () => {
    const submitted = JSON.parse(readFileSync("docs/ghl-whatsapp-template-submission-2026-10-11.json", "utf8"))
    for (const [kind, contract] of Object.entries(appointmentTemplateContracts)) {
        const recorded = submitted.templates.find((t: { name: string }) => t.name === contract.name)
        assert.equal(recorded.meta_template_id, contract.id)
        assert.equal(recorded.meta_create_payload.components[0].text, contract.body)
        assert.deepEqual(recorded.body_variables.map((v: { name: string }) => v.name), contract.variables)
        assert.equal(recorded.submitted_settings.message_send_ttl_seconds, contract.ttlSeconds)
        assert.equal(recorded.meta_language, "en_US")
        assert.equal(validateAppointmentTemplate(approved(kind as keyof typeof appointmentTemplateContracts), kind as keyof typeof appointmentTemplateContracts), contract)
    }
})
test("strict live approval validation rejects Marketing, pending, language fallback, wrong identity, edits and extra buttons", () => {
    for (const changed of [{ status: "PENDING" }, { category: "MARKETING" }, { language: "en" }, { id: "wrong" }, { parameter_format: "NAMED" }, { message_send_ttl_seconds: 3601 }]) {
        assert.throws(() => validateAppointmentTemplate({ ...approved(), ...changed }, "added"))
    }
    const changed = approved(); changed.components[0].text = `${changed.components[0].text} Buy now`
    assert.throws(() => validateAppointmentTemplate(changed, "added"))
    const other = approved(); other.components.push({ type: "FOOTER", text: "Extra text" })
    assert.throws(() => validateAppointmentTemplate(other, "added"))
    const button = approved(); button.components[1].buttons![0].url = "https://portal.scaylup.com/{{1}}"
    assert.throws(() => validateAppointmentTemplate(button, "added"))
})
test("template renders factual positional values independently from the URL parameter and rejects oversized/unmapped input", () => {
    const values = notificationValues(job, now)
    const rendered = appointmentTemplateComponents("added", values, job.summaryToken)
    assert.equal(rendered.components[0].parameters.length, 9)
    assert.equal(rendered.components[1].parameters[0].text, job.summaryToken)
    assert.match(rendered.body, /Alex Morgan/)
    assert.throws(() => appointmentTemplateComponents("added", { ...values, contact_name: "" }, job.summaryToken))
    assert.throws(() => appointmentTemplateComponents("added", { ...values, booking_details: "x".repeat(513) }, job.summaryToken))
    assert.throws(() => appointmentTemplateComponents("added", { ...values, booking_details: "a\nb" }, job.summaryToken))
    assert.throws(() => appointmentTemplateComponents("added", values, "../calendar"))
    assert.throws(() => notificationValues({ ...job, kind: "rescheduled" }, now), /previous/)
})
test("appointment values use full dates and the verified timezone across DST and cross-day schedules", () => {
    assert.match(formatAppointmentInstant("2026-11-01T05:30:00Z", "America/New_York"), /GMT-4/)
    assert.match(formatAppointmentInstant("2026-11-01T06:30:00Z", "America/New_York"), /GMT-5/)
    const values = notificationValues({ ...job, snapshot: { ...snapshot, endTime: "2026-10-15T04:30:00Z" } }, now)
    assert.match(values.schedule, /Oct 14/); assert.match(values.schedule, /Oct 15/)
    assert.throws(() => formatAppointmentInstant("bad", "America/New_York"))
    assert.throws(() => formatAppointmentInstant(now.toISOString(), "invented/timezone"))
})
test("global and profile sending switches prevent even credential reads or claim preparation", async () => {
    for (const modified of [job, { ...job, profile: { ...profile, sendingEnabled: false } }]) {
        const f = deliveryFixture({ sendingEnabled: () => modified === job ? false : true })
        assert.equal(await deliverAppointmentNotification(modified, f.deps), "disabled")
        assert.equal(f.calls.length, 0); assert.equal(f.sends(), 0)
    }
})
test("approved fresh notice commits dispatch before sending and links canonical callback receipt", async () => {
    const f = deliveryFixture()
    assert.equal(await deliverAppointmentNotification(job, f.deps), "accepted")
    assert.equal(f.sends(), 1)
    assert.deepEqual(f.calls.map((c) => c.action), ["notification_context", "begin_dispatch", "finish_dispatch"])
    assert.equal(f.calls[1].input.templateStatus, "APPROVED")
    assert.equal(f.calls[1].input.templateCategory, "UTILITY")
    assert.equal(f.calls[2].input.providerMessageId, "wamid.synthetic")
})
test("changed appointment is durably refreshed and superseded with no send", async () => {
    const f = deliveryFixture({ fetchAppointment: async () => ({ ...snapshot, startTime: "2026-10-15T18:30:00Z" }) })
    assert.equal(await deliverAppointmentNotification(job, f.deps), "superseded")
    assert.equal(f.sends(), 0)
    assert.deepEqual(f.calls.map((c) => c.action), ["notification_context", "ingest", "finish_notification"])
    assert.match(String(f.calls[1].input.payloadHash), /^[0-9a-f]{64}$/)
})
test("unapproved or recategorized templates never cross the dispatch boundary", async () => {
    for (const changed of [{ status: "PENDING" }, { category: "MARKETING" }, { language: "en" }]) {
        const f = deliveryFixture({ liveTemplate: async () => ({ ...approved(), ...changed }) })
        assert.equal(await deliverAppointmentNotification(job, f.deps), "blocked")
        assert.equal(f.sends(), 0)
        assert.equal(f.calls.some((c) => c.action === "begin_dispatch"), false)
    }
})
test("fresh reminder rejects cancellation, already started schedules and changed time", async () => {
    for (const current of [{ ...snapshot, status: "cancelled" }, { ...snapshot, startTime: "2026-10-14T17:30:00Z" }, { ...snapshot, startTime: "2026-10-14T19:30:00Z" }]) {
        const f = deliveryFixture({ fetchAppointment: async () => current })
        assert.equal(await deliverAppointmentNotification({ ...job, kind: "reminder" }, f.deps), "superseded")
        assert.equal(f.sends(), 0)
    }
})
test("pending removal cannot send if the appointment has been restored", async () => {
    const f = deliveryFixture()
    assert.equal(await deliverAppointmentNotification({ ...job, kind: "removed", snapshot: { ...snapshot, deleted: true } }, f.deps), "superseded")
    assert.equal(f.sends(), 0)
})
test("a kill switch changed during template verification still blocks dispatch", async () => {
    let enabled = true
    const f = deliveryFixture({ sendingEnabled: () => enabled, liveTemplate: async () => { enabled = false; return approved() } })
    assert.equal(await deliverAppointmentNotification(job, f.deps), "blocked")
    assert.equal(f.sends(), 0)
})
test("lost begin-dispatch acknowledgement never sends and is quarantined for review", async () => {
    const f = deliveryFixture()
    const original = f.deps.rpc
    f.deps.rpc = async (action, input) => { if (action === "begin_dispatch") { await original(action, input); throw new Error("connection lost after commit") } return original(action, input) }
    assert.equal(await deliverAppointmentNotification(job, f.deps), "uncertain")
    assert.equal(f.sends(), 0)
    assert.equal(f.calls.at(-1)?.input.outcome, "uncertain")
})
test("a definite database refusal at dispatch remains blocked, with no false uncertain message", async () => {
    const f = deliveryFixture()
    const original = f.deps.rpc
    f.deps.rpc = async (action, input) => { if (action === "begin_dispatch") throw new GhlAutomationRejected(action, "consent"); return original(action, input) }
    assert.equal(await deliverAppointmentNotification(job, f.deps), "blocked")
    assert.equal(f.sends(), 0)
    assert.equal(f.calls.at(-1)?.action, "finish_notification")
})
test("lost provider acknowledgement is uncertain and never automatically retried", async () => {
    let sends = 0
    const f = deliveryFixture({ sendTemplate: async () => { sends++; throw new Error("provider connection lost") } })
    assert.equal(await deliverAppointmentNotification(job, f.deps), "uncertain")
    assert.equal(sends, 1)
    assert.equal(f.calls.at(-1)?.input.outcome, "uncertain")
})
test("missing provider message ID or lost receipt persistence remains uncertain", async () => {
    const missing = deliveryFixture({ sendTemplate: async () => ({ messages: [] }) })
    assert.equal(await deliverAppointmentNotification(job, missing.deps), "uncertain")
    const f = deliveryFixture(); const original = f.deps.rpc
    f.deps.rpc = async (action, input) => { if (action === "finish_dispatch" && input.outcome === "accepted") throw new Error("receipt lost"); return original(action, input) }
    assert.equal(await deliverAppointmentNotification(job, f.deps), "uncertain")
    assert.equal(f.sends(), 1)
})

function workerFixture(overrides: Partial<AppointmentWorkerDependencies> = {}) {
    const calls: Array<{ action: string; input: Record<string, unknown> }> = []
    const delivery = deliveryFixture({ sendingEnabled: () => false })
    const deps: AppointmentWorkerDependencies = {
        rpc: async (action, input) => { calls.push({ action, input }); if (action === "event_context") return { profile, current: { version: 1, snapshot }, privateToken: "synthetic-token" }; return { items: [], applied: true, accepted: true } },
        now: () => now, detectionEnabled: () => true, delivery: delivery.deps, fetchAppointment: async () => snapshot, fetchCalendarWindow: async () => ({ appointmentIds: [], complete: true }), ...overrides,
    }
    return { deps, calls }
}
const event = { id: "event1", leaseToken: "lease1", appointmentId: snapshot.id, eventType: "AppointmentUpdate" }
test("detection off touches no queue; detection on and sending off still runs inbox, reconciliation and reminder capture", async () => {
    const off = workerFixture({ detectionEnabled: () => false })
    assert.equal((await runGhlAppointmentAutomation(off.deps)).disabled, true); assert.equal(off.calls.length, 0)
    const f = workerFixture()
    assert.equal((await runGhlAppointmentAutomation(f.deps)).accepted, 0)
    assert.deepEqual(f.calls.map((c) => c.action), ["claim_events", "claim_reconciliations", "enqueue_reminders"])
})
test("webhook wake scopes immediate processing and leaves reconciliation and timers to the scheduled lane", async () => {
    const f = workerFixture(), delivery = deliveryFixture()
    f.deps.delivery = delivery.deps
    let claimed = 0
    const original = f.deps.rpc
    f.deps.rpc = async (action, input) => {
        await original(action, input)
        if (action === "claim_events") return { items: [event] }
        if (action === "event_context") return { profile, current: { version: 1, snapshot }, privateToken: "synthetic" }
        if (action === "claim_notifications") return { items: claimed++ === 0 ? [job] : [] }
        return { applied: true, accepted: true }
    }
    const result = await runGhlAppointmentAutomation(f.deps, { locationId: "location1", appointmentId: "appointment1" })
    assert.equal(result.events, 1); assert.equal(result.accepted, 1)
    assert.equal(f.calls.some(c => ["claim_reconciliations", "enqueue_reminders"].includes(c.action)), false)
    assert.deepEqual(f.calls.filter(c => c.action === "claim_notifications").map(c => c.input), [
        { limit: 1, locationId: "location1", appointmentId: "appointment1" },
        { limit: 1, locationId: "location1", appointmentId: "appointment1" },
    ])
    assert.ok(f.calls.findIndex(c => c.action === "apply_event") < f.calls.findIndex(c => c.action === "claim_notifications"))
    assert.equal(delivery.sends(), 1)
})
test("confirmed missing appointment retains previous details and atomically requests removal/reminder cancellation", async () => {
    const f = workerFixture({ fetchAppointment: async () => null })
    assert.equal(await processGhlEvent(event, f.deps), "applied")
    const applied = f.calls.find((c) => c.action === "apply_event")!.input
    assert.equal((applied.snapshot as AppointmentSnapshot).contactName, snapshot.contactName)
    assert.equal((applied.snapshot as AppointmentSnapshot).deleted, true)
    assert.deepEqual(applied.kinds, ["removed"]); assert.equal(applied.reminderAt, null)
    assert.equal(applied.expectedVersion, 1)
})
test("a provider failure cannot manufacture a deletion or an empty successful snapshot", async () => {
    const f = workerFixture({ fetchAppointment: async () => { throw new Error("403") } })
    assert.equal(await processGhlEvent(event, f.deps), "attention")
    assert.equal(f.calls.some((c) => c.action === "apply_event"), false)
    assert.equal(f.calls.at(-1)?.input.retryable, true)
})
test("a removal without retained details is quarantined instead of inventing a notification", async () => {
    const f = workerFixture({ fetchAppointment: async () => null }); const original = f.deps.rpc
    f.deps.rpc = async (action, input) => action === "event_context" ? { profile, current: null, privateToken: "synthetic" } : original(action, input)
    assert.equal(await processGhlEvent(event, f.deps), "attention")
    assert.equal(f.calls.at(-1)?.input.retryable, false)
})
test("cross-calendar moves remove the old calendar entry while preserving its summary identity", async () => {
    const f = workerFixture({ fetchAppointment: async () => ({ ...snapshot, calendarId: "other" }) })
    await processGhlEvent(event, f.deps)
    const applied = f.calls.find((c) => c.action === "apply_event")!.input
    assert.equal((applied.snapshot as AppointmentSnapshot).calendarId, snapshot.calendarId)
    assert.deepEqual(applied.kinds, ["removed"])
})
test("reconciliation baseline captures a new snapshot without announcing an old appointment", async () => {
    const f = workerFixture(); const original = f.deps.rpc
    f.deps.rpc = async (action, input) => action === "event_context" ? { profile, current: null, privateToken: "synthetic" } : original(action, input)
    await processGhlEvent({ ...event, payload: { baseline: true } }, f.deps)
    assert.deepEqual(f.calls.find((c) => c.action === "apply_event")!.input.kinds, [])
})
test("reconciliation processes ten IDs per tick with a small durable keyset cursor and omission-safe discovery", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `appointment${String(i).padStart(3, "0")}`)
    const f = workerFixture({ fetchCalendarWindow: async () => ({ appointmentIds: ids, complete: true }) })
    const cursor = nextReconcileCursor(null, now)
    await reconcileGhlProfile({ profile, privateToken: "synthetic", leaseToken: "lease1", cursor }, f.deps)
    const ingested = f.calls.filter((c) => c.action === "ingest")
    assert.equal(ingested.length, 10)
    assert.equal(ingested.every((c) => c.input.eventType === "AppointmentUpdate"), true)
    const saved = f.calls.at(-1)!.input.cursor as Record<string, unknown>
    assert.equal(saved.windowAfter, "appointment009"); assert.ok(JSON.stringify(saved).length < 1000)
    f.calls.length = 0
    await reconcileGhlProfile({ profile, privateToken: "synthetic", leaseToken: "lease2", cursor: { ...saved, phase: "window" } }, f.deps)
    assert.equal(f.calls.filter((c) => c.action === "ingest")[0].input.appointmentId, "appointment010")
})
test("an incomplete provider list preserves its durable cursor and enqueues no omissions as removals", async () => {
    const f = workerFixture({ fetchCalendarWindow: async () => { throw Error("truncated provider page") } })
    const cursor = nextReconcileCursor(null, now)
    assert.equal(await reconcileGhlProfile({ profile, privateToken: "synthetic", leaseToken: "lease", cursor }, f.deps), "attention")
    assert.equal(f.calls.some((c) => c.action === "ingest"), false)
    assert.deepEqual(f.calls.at(-1)?.input.cursor, cursor)
})
test("known-identity reconciliation queues point verification rather than inferring deletion", async () => {
    const f = workerFixture(); const original = f.deps.rpc
    f.deps.rpc = async (action, input) => action === "reconciliation_candidates" ? { items: [{ appointmentId: snapshot.id }], nextCursor: null } : original(action, input)
    const cursor = { ...nextReconcileCursor(null, now), phase: "known" as const }
    await reconcileGhlProfile({ profile, privateToken: "synthetic", leaseToken: "lease", cursor }, f.deps)
    const ingest = f.calls.find((c) => c.action === "ingest")!.input
    assert.equal(ingest.appointmentId, snapshot.id); assert.equal(ingest.eventType, "AppointmentUpdate")
    const next = f.calls.at(-1)?.input.cursor as Record<string, unknown>
    assert.equal(next.baseline, true); assert.equal(next.phase, "window"); assert.notEqual(next.knownCycleId, cursor.knownCycleId)
})

 test("removed notice accepts a provider soft-deletion without supersession loops", async () => {
    const removed = { ...snapshot, deleted: true }
    const f = deliveryFixture({ fetchAppointment: async () => removed })
    assert.equal(await deliverAppointmentNotification({ ...job, kind: "removed", snapshot: removed, previousSnapshot: snapshot }, f.deps), "accepted")
    assert.equal(f.sends(), 1)
 })
 test("baseline discovery still notifies changes to previously retained appointments", async () => {
    for (const change of [{ ...snapshot, status: "cancelled" }, { ...snapshot, startTime: "2026-10-15T18:30:00Z", endTime: "2026-10-15T19:00:00Z" }]) {
        const f = workerFixture({ fetchAppointment: async () => change })
        await processGhlEvent({ ...event, payload: { baseline: true } }, f.deps)
        assert.deepEqual(f.calls.find((c) => c.action === "apply_event")!.input.kinds, [change.status === "cancelled" ? "cancelled" : "rescheduled"])
    }
 })
 test("known identities get a turn between discovery pages, before the distant future horizon completes", async () => {
    const f = workerFixture()
    const cursor = nextReconcileCursor(null, now)
    await reconcileGhlProfile({ profile, privateToken: "synthetic", leaseToken: "lease", cursor }, f.deps)
    const next = f.calls.at(-1)?.input.cursor as Record<string, unknown>
    assert.equal(next.phase, "known")
    assert.ok(Date.parse(String(next.windowStart)) < Date.parse(String(next.horizonEnd)))
 })

 test("full intake batches backpressure reconciliation instead of growing a synthetic-event backlog", async () => {
    const f = workerFixture(); const original = f.deps.rpc
    f.deps.rpc = async (action, input) => {
        if (action === "claim_events") { await original(action, input); return { items: Array.from({ length: 5 }, (_, i) => ({ ...event, id: `event${i}` })) } }
        return original(action, input)
    }
    await runGhlAppointmentAutomation(f.deps)
    assert.equal(f.calls.filter((c) => c.action === "apply_event").length, 5)
    assert.equal(f.calls.some((c) => c.action === "claim_reconciliations"), false)
    assert.equal(f.calls.some((c) => c.action === "enqueue_reminders"), true)
 })

 test("definite supersession, including an already-dispatched same-schedule reminder, terminates quietly", async () => {
    const f = deliveryFixture(); const original = f.deps.rpc
    f.deps.rpc = async (action, input) => { if (action === "begin_dispatch") throw new GhlAutomationRejected(action, "superseded"); return original(action, input) }
    assert.equal(await deliverAppointmentNotification({ ...job, kind: "reminder" }, f.deps), "superseded")
    assert.equal(f.sends(), 0); assert.equal(f.calls.at(-1)?.input.outcome, "superseded")
 })
 test("an incomplete dispatch acknowledgement is uncertain, never reported as harmless supersession", async () => {
    const f = deliveryFixture(); const original = f.deps.rpc
    f.deps.rpc = async (action, input) => action === "begin_dispatch" ? {} : original(action, input)
    assert.equal(await deliverAppointmentNotification(job, f.deps), "uncertain")
    assert.equal(f.sends(), 0); assert.equal(f.calls.at(-1)?.input.outcome, "uncertain")
 })
 test("a stale notification is not discarded unless its refresh was durably accepted", async () => {
    const f = deliveryFixture({ fetchAppointment: async () => ({ ...snapshot, status: "cancelled" }) }); const original = f.deps.rpc
    f.deps.rpc = async (action, input) => action === "ingest" ? { accepted: false } : original(action, input)
    assert.equal(await deliverAppointmentNotification(job, f.deps), "blocked")
    assert.equal(f.sends(), 0); assert.equal(f.calls.at(-1)?.input.outcome, "blocked")
 })


test("disabled runtime returns before loading database or provider adapters", async () => {
    const saved = process.env.GHL_APPOINTMENT_DETECTION_ENABLED
    delete process.env.GHL_APPOINTMENT_DETECTION_ENABLED
    try { assert.equal((await processGhlAppointmentAutomation()).disabled, true) }
    finally { if (saved === undefined) delete process.env.GHL_APPOINTMENT_DETECTION_ENABLED; else process.env.GHL_APPOINTMENT_DETECTION_ENABLED = saved }
})

test('moves between selected calendars produce one update, including identical calendar names', async () => {
    const multiple = { ...profile, calendars: [{ id: 'calendar1', name: 'Consultations' }, { id: 'calendar2', name: 'Consultations' }] }
    const moved = { ...snapshot, calendarId: 'calendar2' }
    const f = workerFixture({ fetchAppointment: async () => moved }); const original = f.deps.rpc
    f.deps.rpc = async (action, input) => action === 'event_context' ? { profile: multiple, current: { version: 7, snapshot }, privateToken: 'synthetic' } : original(action, input)
    assert.equal(await processGhlEvent(event, f.deps), 'applied')
    const applied = f.calls.find(c => c.action === 'apply_event')!.input
    assert.deepEqual(applied.kinds, ['details_updated']); assert.equal(applied.expectedVersion, 7)
    assert.equal((applied.snapshot as AppointmentSnapshot).deleted, false)
    assert.equal((applied.snapshot as AppointmentSnapshot).calendarId, 'calendar2')
    assert.match(String(applied.changedDetails), /Calendar changed/)
})
test('all seven notification kinds verify appointments in a secondary selected calendar', async () => {
    const multiple = { ...profile, calendars: [{ id: 'calendar1', name: 'Consultations' }, { id: 'calendar2', name: 'Estimates' }] }
    for (const kind of Object.keys(appointmentTemplateContracts) as NotificationJob['kind'][]) {
        const current = { ...snapshot, calendarId: 'calendar2', calendarName: 'Estimates', deleted: kind === 'removed' }
        const f = deliveryFixture({ fetchAppointment: async () => current }); const original = f.deps.rpc
        f.deps.rpc = async (action, input) => action === 'notification_context' ? { profile: multiple, privateToken: 'synthetic', destination: '+12025550123' } : original(action, input)
        assert.equal(await deliverAppointmentNotification({ ...job, profile: multiple, kind, snapshot: current, previousSnapshot: snapshot, changedDetails: 'Calendar: Estimates' }, f.deps), 'accepted', kind)
        assert.equal(f.sends(), 1, kind)
    }
})
test('reconciliation rotates selected calendars without increasing provider calls per turn', async () => {
    const multiple = { ...profile, calendars: [{ id: 'calendar1', name: 'Consultations' }, { id: 'calendar2', name: 'Estimates' }] }
    const providerCalls: string[] = [], f = workerFixture({ fetchCalendarWindow: async p => { providerCalls.push(p.calendarId); return { appointmentIds: ['one'], complete: true } } })
    let cursor = nextReconcileCursor(null, now); const start = cursor.windowStart
    const turn = async () => { await reconcileGhlProfile({ profile: multiple, privateToken: 'synthetic', leaseToken: 'lease', cursor }, f.deps); cursor = f.calls.at(-1)!.input.cursor as typeof cursor }
    await turn(); assert.deepEqual(providerCalls, ['calendar1']); assert.equal(cursor.windowStart, start); assert.equal(cursor.calendarIndex, 1)
    await turn(); assert.deepEqual(providerCalls, ['calendar1'])
    await turn(); assert.deepEqual(providerCalls, ['calendar1', 'calendar2']); assert.ok(cursor.windowStart > start); assert.equal(cursor.calendarIndex, 0)
    const observations = f.calls.filter(c => c.action === 'ingest')
    assert.deepEqual(observations.map(c => c.input.calendarId), ['calendar1', 'calendar2'])
    assert.notEqual(observations[0].input.eventKey, observations[1].input.eventKey)
})
