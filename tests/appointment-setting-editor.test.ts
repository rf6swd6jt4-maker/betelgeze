import assert from "node:assert/strict"
import test from "node:test"
import { AppointmentDraftQueue } from "../lib/appointment-draft-queue.ts"
import { appointmentReadiness, appointmentTimeCandidates, appointmentWithChanges, appointmentView, sortAppointmentWork, type AppointmentSettingAppointment } from "../lib/appointment-setting.ts"

const draft = { id: "a", workflow_status: "draft", updated_at: "2026-09-09T10:00:00Z", created_at: "2026-09-09T10:00:00Z", contact_name: "Alex", phone: "(214) 555-0199", appointment_date: "2026-09-10", appointment_time: "14:00", appointment_timezone: "America/Chicago", meeting_medium: "phone", meeting_link: null, details: {} } as AppointmentSettingAppointment
const configuration = { mediums: ["phone" as const], fields: [{ key: "phone" as const, required: true }] }

test("appointment readiness follows client requirements and the selected meeting type", () => {
    assert.deepEqual(appointmentReadiness(draft, configuration), [])
    assert.deepEqual(appointmentReadiness({ ...draft, contact_name: null, phone: "123", appointment_date: "2026-02-30" }, configuration).map((issue) => issue.field), ["contact_name", "appointment_date", "detail:phone"])
    assert.deepEqual(appointmentReadiness({ ...draft, meeting_link: "not needed for a phone call" }, configuration), [])
    const remote = { mediums: ["zoom" as const], fields: [{ key: "email" as const, required: true }, { key: "notes" as const, required: false }] }
    assert.deepEqual(appointmentReadiness({ ...draft, meeting_medium: "zoom" }, remote).map((issue) => issue.field), ["meeting_link", "detail:email"])
    assert.deepEqual(appointmentReadiness({ ...draft, meeting_medium: "zoom", meeting_link: "https://zoom.us/j/123", details: { email: "a@example.com" } }, remote), [])
})

test("timezone conversion handles date boundaries, DST gaps, and repeated hours explicitly", () => {
    assert.deepEqual(appointmentTimeCandidates("2026-09-10", "14:00", "America/Chicago"), [Date.parse("2026-09-10T19:00:00Z")])
    assert.deepEqual(appointmentTimeCandidates("2026-09-10", "00:30", "Asia/Kolkata"), [Date.parse("2026-09-09T19:00:00Z")])
    assert.deepEqual(appointmentTimeCandidates("2026-03-08", "02:30", "America/New_York"), [])
    assert.equal(appointmentTimeCandidates("2026-11-01", "01:30", "America/New_York").length, 2)
    assert.deepEqual(appointmentTimeCandidates("2026-09-10", "14:00", "Bad/Zone"), [])
    assert.match(appointmentReadiness({ ...draft, appointment_date: "2026-11-01", appointment_time: "01:30", appointment_timezone: "America/New_York" }, configuration)[0].message, /occurs twice/)
})

test("draft edits preserve independent detail fields and multiline notes", () => {
    const row = appointmentWithChanges(draft, { "detail:email": "a@example.com", "detail:notes": "First line\nSecond line", appointment_timezone: "Europe/Dublin" })
    assert.equal(row.details.notes, "First line\nSecond line")
    assert.equal(row.details.email, "a@example.com")
    assert.equal(row.phone, draft.phone)
    assert.deepEqual(draft.details, {})
})

test("a save in flight never overwrites newer typing, and submission flush waits for every change", async () => {
    const calls: Array<{ version: string; changes: object }> = []
    let finish!: (result: { ok: true; data: typeof draft }) => void
    const queue = new AppointmentDraftQueue<typeof draft, "contact_name" | "phone">(draft, async (row, changes) => {
        calls.push({ version: row.updated_at, changes })
        if (calls.length === 1) return new Promise((resolve) => { finish = resolve })
        return { ok: true, data: { ...row, ...changes, updated_at: "2026-09-09T10:02:00Z" } }
    }, 60_000)
    queue.edit("contact_name", "Alex M")
    const flushed = queue.flush()
    queue.edit("contact_name", "Alex Morgan")
    queue.edit("phone", "(214) 555-0123")
    assert.equal(queue.getSnapshot().changes.contact_name, "Alex Morgan")
    finish({ ok: true, data: { ...draft, contact_name: "Alex M", updated_at: "2026-09-09T10:01:00Z" } })
    assert.equal(await flushed, true)
    assert.deepEqual(calls, [
        { version: draft.updated_at, changes: { contact_name: "Alex M" } },
        { version: "2026-09-09T10:01:00Z", changes: { contact_name: "Alex Morgan", phone: "(214) 555-0123" } },
    ])
    assert.deepEqual(queue.getSnapshot().changes, {})
    assert.equal(queue.getSnapshot().record.contact_name, "Alex Morgan")
    await queue.flush()
})

test("failed saves preserve text and retry using the last confirmed version", async () => {
    let attempts = 0
    const queue = new AppointmentDraftQueue<typeof draft, "contact_name">(draft, async (row, changes) => {
        if (++attempts === 1) throw new Error("Offline")
        assert.equal(row.updated_at, draft.updated_at)
        return { ok: true, data: { ...row, ...changes, updated_at: "2026-09-09T10:01:00Z" } }
    }, 60_000)
    queue.edit("contact_name", "Preserve this")
    assert.equal(await queue.flush(), false)
    assert.equal(queue.getSnapshot().changes.contact_name, "Preserve this")
    assert.equal(queue.getSnapshot().error, "Offline")
    assert.equal(await queue.retry(), true)
    assert.equal(queue.getSnapshot().record.contact_name, "Preserve this")
})

test("remote changes require review and cannot silently replace local edits", async () => {
    const calls: string[] = []
    const queue = new AppointmentDraftQueue<typeof draft, "contact_name">(draft, async (row, changes) => {
        calls.push(row.updated_at)
        return { ok: true, data: { ...row, ...changes, updated_at: "2026-09-09T10:02:00Z" } }
    }, 60_000)
    queue.edit("contact_name", "My correction")
    const remote = { ...draft, contact_name: "Other setter", updated_at: "2026-09-09T10:01:00Z" }
    queue.receive(remote)
    assert.equal(await queue.flush(), false)
    assert.equal(await queue.retry(), false)
    assert.equal(queue.getSnapshot().changes.contact_name, "My correction")
    assert.equal(queue.getSnapshot().record.contact_name, "Other setter")
    assert.equal(await queue.keepChangesAfterReview(remote), true)
    assert.deepEqual(calls, [remote.updated_at])
    queue.receive(draft)
    assert.equal(queue.getSnapshot().record.contact_name, "My correction")
})

test("remote submission and removal retain unsaved text without allowing writes", async () => {
    const queue = new AppointmentDraftQueue<typeof draft, "contact_name">(draft, async () => { throw new Error("Must not save") }, 60_000)
    queue.edit("contact_name", "Keep for recovery")
    const submitted = { ...draft, workflow_status: "submitted" as const, updated_at: "2026-09-09T10:01:00Z" }
    queue.receive(submitted)
    assert.equal(await queue.flush(), false)
    assert.equal(await queue.keepChangesAfterReview(submitted), false)
    assert.equal(queue.getSnapshot().changes.contact_name, "Keep for recovery")
    queue.markUnavailable()
    assert.match(queue.getSnapshot().error!, /no longer available/)
    queue.discardChanges(submitted)
    assert.deepEqual(queue.getSnapshot().changes, {})
})

test("upcoming appointments show nearest first and past appointments show newest first", () => {
    const now = Date.parse("2026-09-09T12:00:00Z")
    const booked = (id: string, date: string) => ({ ...draft, id, workflow_status: "submitted" as const, appointment_at: date })
    const rows = [booked("old", "2026-09-01T12:00:00Z"), booked("far", "2026-09-15T12:00:00Z"), draft, booked("recent", "2026-09-08T12:00:00Z"), booked("near", "2026-09-10T12:00:00Z")]
    assert.deepEqual(sortAppointmentWork(rows, now).map((row) => row.id), ["a", "near", "far", "recent", "old"])
    assert.equal(appointmentView(rows[0], now), "past")
    assert.equal(appointmentView(draft, now), "drafts")
})

test("saving a focused field preserves trailing spaces and caret-friendly raw input until blur", async () => {
    const queue = new AppointmentDraftQueue<typeof draft, "contact_name">(draft, async (row, changes) => ({ ok: true, data: { ...row, contact_name: changes.contact_name!.trim(), updated_at: "2026-09-09T10:01:00Z" } }), 60_000)
    queue.focus("contact_name")
    queue.edit("contact_name", "Alex ")
    await queue.flush()
    assert.equal(queue.getSnapshot().record.contact_name, "Alex")
    assert.equal(queue.getSnapshot().inputValues.contact_name, "Alex ")
    assert.deepEqual(queue.getSnapshot().changes, {})
    queue.edit("contact_name", "Alex Morgan")
    queue.blur()
    await queue.flush()
    assert.equal(queue.getSnapshot().record.contact_name, "Alex Morgan")
    assert.deepEqual(queue.getSnapshot().inputValues, {})
})
