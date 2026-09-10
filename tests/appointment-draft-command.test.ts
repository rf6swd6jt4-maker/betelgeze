import assert from "node:assert/strict"
import test from "node:test"
import { AppointmentDraftQueue, type PersistedAppointmentDraft } from "../lib/appointment-draft-queue.ts"
import { appointmentDraftCommandIsSameOrigin, parseAppointmentDraftCommand, parsePersistedAppointmentDraft } from "../lib/appointment-draft-command.ts"
import { clearAppointmentDraftRuntime, getAppointmentDraftQueue, retainAppointmentDraftQueue } from "../lib/appointment-draft-runtime.ts"
import type { AppointmentSettingAppointment, AppointmentUpdateField } from "../lib/appointment-setting.ts"

const uuid = "12345678-1234-1234-1234-123456789012"
const original = { id: uuid, updated_at: "2026-09-10T10:00:00.000Z", workflow_status: "draft", contact_name: "Original" } as AppointmentSettingAppointment
const command = { expectedUserId: uuid, appointmentId: uuid, requestId: uuid, expectedUpdatedAt: original.updated_at, changes: { contact_name: "Edited" } }

test("draft command admits only scoped, bounded fields and explicit browser origin", () => {
    assert.deepEqual(parseAppointmentDraftCommand(command), command)
    for (const value of [null, [], { ...command, changes: {} }, { ...command, expectedUserId: "" }, { ...command, expectedUpdatedAt: "tomorrow" }, { ...command, changes: { workflow_status: "submitted" } }, { ...command, changes: { contact_name: 8 } }, { ...command, changes: { "detail:notes": "x".repeat(2_001) } }]) assert.equal(parseAppointmentDraftCommand(value), null)
    const request = (origin?: string, site?: string) => new Request("https://app.betelgeze.com/api/save", { method: "POST", headers: { ...(origin ? { origin } : {}), ...(site ? { "sec-fetch-site": site } : {}) } })
    assert.equal(appointmentDraftCommandIsSameOrigin(request("https://app.betelgeze.com", "same-origin")), true)
    for (const origin of [undefined, "null", "https://evil.example", "https://portal.betelgeze.com"]) assert.equal(appointmentDraftCommandIsSameOrigin(request(origin)), false)
    assert.equal(appointmentDraftCommandIsSameOrigin(request("https://app.betelgeze.com", "cross-site")), false)
})

test("a lost acknowledgement replays its exact persisted request before later typing", async () => {
    let disk: PersistedAppointmentDraft<"contact_name"> | null = null
    const storage = { read: () => structuredClone(disk), write: (value: typeof disk) => { disk = structuredClone(value) } }
    const calls: Array<{ requestId: string; version: string; changes: object }> = []
    let reject!: (error: Error) => void
    const first = new AppointmentDraftQueue<typeof original, "contact_name">(original, async (_row, changes, command) => {
        calls.push({ requestId: command.requestId, version: command.version, changes })
        assert.equal(storage.read()?.pending?.requestId, command.requestId, "request identity is durable before dispatch")
        return new Promise((_resolve, fail) => { reject = fail })
    }, 60_000)
    first.attachStorage(storage)
    first.edit("contact_name", "First edit")
    const saving = first.flush()
    first.edit("contact_name", "Latest edit")
    reject(new Error("Acknowledgement lost"))
    assert.equal(await saving, false)
    first.stop()
    const committed = { ...original, contact_name: "First edit", updated_at: "2026-09-10T10:00:01.000Z" }
    const reopened = new AppointmentDraftQueue<typeof original, "contact_name">(committed, async (row, changes, command) => {
        calls.push({ requestId: command.requestId, version: command.version, changes })
        if (calls.length === 2) return { ok: true, data: committed, version: committed.updated_at }
        return { ok: true, data: { ...row, ...changes, updated_at: "2026-09-10T10:00:02.000Z" }, version: "2026-09-10T10:00:02.000Z" }
    }, 60_000)
    reopened.attachStorage(storage)
    assert.equal(await reopened.flush(), true)
    assert.deepEqual(calls[1], calls[0])
    assert.notEqual(calls[2].requestId, calls[0].requestId)
    assert.equal(calls[2].version, committed.updated_at)
    assert.deepEqual(calls[2].changes, { contact_name: "Latest edit" })
    assert.equal(disk, null)
    assert.equal(reopened.getSnapshot().record.contact_name, "Latest edit")
})

test("a replay observing another writer preserves remaining local changes for review", async () => {
    const latest = { ...original, contact_name: "Changed elsewhere", updated_at: "2026-09-10T10:00:03.000Z" }
    const saved = { version: original.updated_at, changes: { contact_name: "My latest edit" }, conflict: false, pending: { requestId: uuid, version: original.updated_at, changes: { contact_name: "My first edit" } } }
    let count = 0
    const queue = new AppointmentDraftQueue<typeof original, "contact_name">(latest, async () => {
        count += 1
        return { ok: true, data: latest, version: "2026-09-10T10:00:01.000Z" }
    })
    queue.attachStorage({ read: () => saved, write: () => {} })
    assert.equal(await queue.flush(), false)
    assert.equal(count, 1)
    assert.equal(queue.getSnapshot().record.contact_name, "Changed elsewhere")
    assert.equal(queue.getSnapshot().changes.contact_name, "My latest edit")
    assert.equal(queue.getSnapshot().conflict, true)
    assert.equal(await queue.retry(), false)
})

test("checkpoint distinguishes durable intent from a storage failure and server acknowledgement", async () => {
    let writesFail = false
    let disk: PersistedAppointmentDraft<"contact_name"> | null = null
    const queue = new AppointmentDraftQueue<typeof original, "contact_name">(original, async () => { throw new Error("Offline") }, 60_000)
    queue.attachStorage({ read: () => disk, write: (value) => { if (writesFail) throw new Error("Quota"); disk = value } })
    queue.edit("contact_name", "Device edit")
    assert.equal(queue.checkpoint(), true)
    assert.equal(queue.getSnapshot().record.contact_name, "Original")
    writesFail = true
    queue.edit("contact_name", "Newer unsaved edit")
    assert.equal(queue.checkpoint(), false)
    assert.match(queue.getSnapshot().storageError!, /storage is unavailable/)
    assert.equal(await queue.flush(), false)
    queue.stop()
})

test("clearing an account prevents an in-flight response recreating drafts or draining newer intent", async () => {
    let complete!: (result: { ok: true; data: typeof original }) => void
    let writes = 0
    let requests = 0
    const queue = new AppointmentDraftQueue<typeof original, "contact_name">(original, async () => {
        requests += 1
        return new Promise((resolve) => { complete = resolve })
    }, 60_000)
    queue.attachStorage({ read: () => null, write: () => { writes += 1 } })
    queue.edit("contact_name", "First")
    const saving = queue.flush()
    queue.edit("contact_name", "Never send under next account")
    queue.stop()
    const afterStop = writes
    complete({ ok: true, data: { ...original, contact_name: "First", updated_at: "2026-09-10T10:00:01Z" } })
    assert.equal(await saving, false)
    assert.equal(writes, afterStop)
    assert.equal(requests, 1)
    assert.equal(await queue.retry(), false)
})

test("one queue survives an editor unmount while an acknowledged save is still pending", async () => {
    const priorChannel = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel")
    Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true })
    const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
    Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true })
    try {
        let complete!: (result: { ok: true; data: typeof original }) => void
        const create = () => new AppointmentDraftQueue<typeof original, AppointmentUpdateField>(original, async () => new Promise((resolve) => { complete = resolve }), 60_000)
        const queue = getAppointmentDraftQueue("account:workspace:appointment", create)
        const release = retainAppointmentDraftQueue("account:workspace:appointment", queue)
        queue.edit("contact_name", "Keep sending")
        const saving = queue.flush()
        release()
        assert.equal(getAppointmentDraftQueue("account:workspace:appointment", create), queue)
        const releaseReopened = retainAppointmentDraftQueue("account:workspace:appointment", queue)
        complete({ ok: true, data: { ...original, contact_name: "Keep sending", updated_at: "2026-09-10T10:00:01Z" } })
        assert.equal(await saving, true)
        assert.equal(queue.getSnapshot().record.contact_name, "Keep sending")
        releaseReopened()
        assert.notEqual(getAppointmentDraftQueue("account:workspace:appointment", create), queue, "an unused, clean queue is released")
    } finally {
        clearAppointmentDraftRuntime()
        if (priorChannel) Object.defineProperty(globalThis, "BroadcastChannel", priorChannel)
        if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow)
        else Reflect.deleteProperty(globalThis, "window")
    }
})

test("persisted transport cannot change when a feature flag rolls back", () => {
    const persisted = parsePersistedAppointmentDraft({ version: original.updated_at, changes: command.changes, conflict: false, pending: { requestId: uuid, version: original.updated_at, changes: command.changes, transport: "command" } })
    assert.equal(persisted?.pending?.transport, "command")
    assert.equal(parsePersistedAppointmentDraft({ version: original.updated_at, changes: command.changes, pending: { requestId: uuid, version: original.updated_at, changes: command.changes, transport: "unknown" } })?.conflict, true)
})

test("replay conflict fences keep PostgreSQL microseconds and normalize equivalent UTC formats", async () => {
    const latest = { ...original, updated_at: "2026-09-10T10:00:00.000002+00:00" }
    const queue = new AppointmentDraftQueue<typeof original, "contact_name">(latest, async () => ({ ok: true, data: latest, version: "2026-09-10T10:00:00.000001+00:00" }))
    queue.attachStorage({
        read: () => ({ version: original.updated_at, changes: { contact_name: "Later typing" }, conflict: false, pending: { requestId: uuid, version: original.updated_at, changes: { contact_name: "First edit" } } }),
        write: () => {},
    })
    assert.equal(await queue.flush(), false)
    assert.equal(queue.getSnapshot().conflict, true)
    const equivalent = new AppointmentDraftQueue<typeof original, "contact_name">(original, async () => ({ ok: true, data: original }))
    equivalent.attachStorage({ read: () => ({ version: "2026-09-10T10:00:00+00:00", changes: { contact_name: "Name" }, conflict: false }), write: () => {} })
    assert.equal(await equivalent.flush(), true)
    assert.equal(equivalent.getSnapshot().conflict, false)
})
