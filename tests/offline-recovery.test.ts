import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { deliveryOutcome } from "../public/offline-store.js"
import { AppointmentDraftQueue, type PersistedAppointmentDraft } from "../lib/appointment-draft-queue.ts"

test("outbox only accepts a structured acknowledgment; temporary failures stay retryable", () => {
    assert.equal(deliveryOutcome(200, { message: { id: "saved", clientRequestId: "request" } }), "sent")
    for (const result of [null, {}, { message: {} }, { message: "ok" }, { message: { id: "saved" } }]) assert.equal(deliveryOutcome(200, result), "queued")
    for (const status of [0, 408, 429, 500, 503]) assert.equal(deliveryOutcome(status, { error: "Unavailable" }), "queued")
    for (const status of [400, 401, 403, 404, 409, 422]) assert.equal(deliveryOutcome(status, { error: "Needs review" }), "blocked")
})

const record = { updated_at: "2026-09-09T10:00:00Z", workflow_status: "draft" as const, contact_name: "Original" }

test("appointment changes survive a failed request and restore after reopening", async () => {
    let disk: PersistedAppointmentDraft<"contact_name"> | null = null
    const storage = { read: () => disk, write: (value: typeof disk) => { disk = value ? structuredClone(value) : null } }
    const first = new AppointmentDraftQueue<typeof record, "contact_name">(record, async () => { throw new Error("Offline") }, 60_000)
    first.attachStorage(storage)
    first.edit("contact_name", "Recovered name")
    assert.equal(await first.flush(), false)
    assert.equal(storage.read()?.changes.contact_name, "Recovered name")
    const second = new AppointmentDraftQueue<typeof record, "contact_name">(record, async (row, changes) => ({ ok: true, data: { ...row, ...changes, updated_at: "2026-09-09T10:01:00Z" } }), 60_000)
    second.attachStorage(storage)
    await second.flush()
    assert.equal(second.getSnapshot().record.contact_name, "Recovered name")
    assert.equal(disk, null)
})

test("a recovered draft never overwrites a newer server version without review", async () => {
    let saves = 0
    let disk: PersistedAppointmentDraft<"contact_name"> | null = { version: record.updated_at, changes: { contact_name: "Offline edit" }, conflict: false }
    const latest = { ...record, updated_at: "2026-09-09T11:00:00Z", contact_name: "Edited elsewhere" }
    const queue = new AppointmentDraftQueue<typeof record, "contact_name">(latest, async () => { saves++; return { ok: true, data: latest } }, 60_000)
    queue.attachStorage({ read: () => disk, write: (value) => { disk = value } })
    assert.equal(await queue.flush(), false)
    assert.equal(saves, 0)
    assert.equal(queue.getSnapshot().changes.contact_name, "Offline edit")
    assert.equal(queue.getSnapshot().record.contact_name, "Edited elsewhere")
    assert.equal(queue.getSnapshot().conflict, true)
    const reopened = new AppointmentDraftQueue<typeof record, "contact_name">(latest, async () => { saves++; return { ok: true, data: latest } }, 60_000)
    reopened.attachStorage({ read: () => disk, write: (value) => { disk = value } })
    assert.equal(reopened.getSnapshot().conflict, true)
    assert.equal(await reopened.flush(), false)
    assert.equal(saves, 0)
})

test("device storage failure does not block ordinary online appointment saving", async () => {
    const queue = new AppointmentDraftQueue<typeof record, "contact_name">(record, async (row, changes) => ({ ok: true, data: { ...row, ...changes } }), 60_000)
    queue.attachStorage({ read: () => null, write: () => { throw new Error("Quota exceeded") } })
    queue.edit("contact_name", "Online edit")
    assert.ok(queue.getSnapshot().storageError)
    assert.equal(await queue.flush(), true)
    assert.equal(queue.getSnapshot().record.contact_name, "Online edit")
})

test("offline queue writes are constrained to the original account and workspace", () => {
    for (const relative of ["messages", "native/messages"]) {
        const route = readFileSync(`app/api/workspaces/[workspaceSlug]/communications/${relative}/route.ts`, "utf8")
        assert.match(route, /input\.offlineUserId !== user\.id/)
        assert.match(route, /input\.offlineWorkspaceId !== workspace\.id/)
        assert.match(route, /clientRequestId/)
    }
    const worker = readFileSync("public/sw.js", "utf8")
    assert.match(worker, /event\.request\.mode === "navigate"/)
    assert.match(worker, /return preloaded \|\| fetch\(event\.request\)/)
    assert.doesNotMatch(worker, /cache\.put\(event\.request/)
})
