import assert from "node:assert/strict"
import test from "node:test"
import { RelationshipDraftQueue, type PersistedRelationshipDraft } from "../lib/relationship-draft-queue.ts"
import { createRelationshipDraftStorage, parsePersistedRelationshipDraft, parseRelationshipBackgroundCommand, relationshipBackgroundCommandIsSameOrigin, type RelationshipDraft } from "../lib/relationship-draft-command.ts"

const v1 = "2026-09-10T10:00:00.000Z", v2 = "2026-09-10T10:00:01.000Z", v3 = "2026-09-10T10:00:02.000Z"
const initial: RelationshipDraft = { primaryPersonName: "Client", businessName: "Company", primaryContactRole: "", primaryPhone: "", whatsappPhone: "", communicationPrimaryProvider: "twilio_sms", communicationDeliveryMode: "primary_only", primaryEmail: "", description: "", sellerUserId: "", fulfilmentManagerUserId: "", fulfilmentTeamId: "", projectTimeframeDays: null, serviceAssignees: {}, selectedCodes: [], upfrontPrices: {}, recurringPrices: {}, currency: "USD", billingInterval: "month", billingIntervalCount: 1 }
function storage(initial: PersistedRelationshipDraft | null = null) { let stored = initial; return { read: () => stored, write: (value: PersistedRelationshipDraft | null) => { stored = structuredClone(value) } } }

test("relationship edits persist synchronously and newer typing drains in order", async () => {
    const saved = storage()
    let finish!: () => void
    const sent: Array<{ requestId: string; version: string; name: string }> = []
    const queue = new RelationshipDraftQueue(initial, v1, async (command) => {
        sent.push({ requestId: command.requestId, version: command.version, name: command.values.primaryPersonName })
        if (sent.length === 1) await new Promise<void>((resolve) => { finish = resolve })
        return { ok: true, version: sent.length === 1 ? v2 : v3, values: command.values }
    }, "command", 100_000)
    queue.attachStorage(saved)
    queue.edit((draft) => ({ ...draft, primaryPersonName: "First" }))
    assert.equal(saved.read()?.draft.primaryPersonName, "First")
    const pending = queue.flush()
    assert.equal(saved.read()?.pending?.requestId, sent[0].requestId)
    queue.edit((draft) => ({ ...draft, primaryPersonName: "Second", currency: "EUR" }))
    assert.equal(queue.checkpoint(), true)
    finish()
    assert.equal(await pending, true)
    assert.deepEqual(sent.map(({ version, name }) => [version, name]), [[v1, "First"], [v2, "Second"]])
    assert.notEqual(sent[0].requestId, sent[1].requestId)
    assert.equal(saved.read()?.draft.currency, "EUR")
    assert.equal(queue.getSnapshot().baseline.currency, "USD")
    queue.stop()
})

test("lost acknowledgement retains the same command across reload before newer edits", async () => {
    const saved = storage()
    let firstId = ""
    const first = new RelationshipDraftQueue(initial, v1, async (command) => { firstId = command.requestId; throw new Error("Lost acknowledgement") }, "command", 100_000)
    first.attachStorage(saved)
    first.edit((draft) => ({ ...draft, description: "Preserve me" }))
    assert.equal(await first.flush(), false)
    first.stop()
    const seen: string[] = []
    const restored = new RelationshipDraftQueue({ ...initial, description: "Preserve me" }, v2, async (command) => { seen.push(command.requestId); return { ok: true, version: v2, currentVersion: v2, values: command.values } }, "command", 100_000)
    restored.attachStorage(saved)
    assert.equal(await restored.flush(), true)
    assert.deepEqual(seen, [firstId])
    assert.equal(saved.read(), null)
    restored.stop()
})

test("feature rollback preserves an uncertain command and switches only later saves", async () => {
    const calls: Array<{ requestId: string; transport: string }> = []
    const queue = new RelationshipDraftQueue(initial, v1, async (command) => {
        calls.push({ requestId: command.requestId, transport: command.transport })
        if (calls.length === 1) throw new Error("Acknowledgement lost")
        return { ok: true, version: calls.length === 2 ? v2 : v3, values: command.values }
    }, "command", 100_000)
    queue.attachStorage(storage())
    queue.edit((draft) => ({ ...draft, description: "First" }))
    assert.equal(await queue.flush(), false)
    queue.setTransport("action")
    queue.edit((draft) => ({ ...draft, description: "Second" }))
    assert.equal(await queue.flush(), true)
    assert.deepEqual(calls.map((call) => call.transport), ["command", "command", "action"])
    assert.equal(calls[0].requestId, calls[1].requestId)
    assert.notEqual(calls[1].requestId, calls[2].requestId)
    queue.stop()
})

test("legacy action mode keeps conditional saves and preserves ambiguous acknowledgement for review", async () => {
    let version = v1, writes = 0
    const transports: string[] = []
    const queue = new RelationshipDraftQueue(initial, v1, async (command) => {
        transports.push(command.transport)
        if (command.version !== version) return { ok: false, conflict: true, version, error: "Review the latest relationship" }
        writes++
        version = v2
        throw new Error("Legacy response lost")
    }, "action", 100_000)
    queue.attachStorage(storage())
    queue.edit((draft) => ({ ...draft, description: "Saved once", currency: "EUR" }))
    assert.equal(await queue.flush(), false)
    assert.equal(await queue.flush(), false)
    assert.equal(writes, 1)
    assert.deepEqual(transports, ["action", "action"])
    assert.equal(queue.getSnapshot().conflict, true)
    assert.equal(queue.getSnapshot().draft.currency, "EUR")
    queue.receive({ ...initial, description: "Saved once" }, v2)
    assert.equal(queue.resolveConflict(true), true)
    assert.equal(await queue.flush(), true)
    assert.equal(writes, 1)
    assert.equal(queue.getSnapshot().draft.currency, "EUR")
    queue.stop()
})

test("replayed receipt cannot overwrite a later authoritative change", async () => {
    const saved = storage()
    const queue = new RelationshipDraftQueue(initial, v1, async (command) => ({ ok: true, version: v2, currentVersion: v3, values: { ...command.values, description: "Someone else's edit" } }), "command", 100_000)
    queue.attachStorage(saved)
    queue.edit((draft) => ({ ...draft, description: "My edit", currency: "EUR" }))
    assert.equal(await queue.flush(), false)
    assert.equal(queue.getSnapshot().draft.description, "My edit")
    assert.equal(queue.getSnapshot().conflict, true)
    queue.receive({ ...initial, description: "Someone else's edit" }, v3)
    assert.equal(queue.resolveConflict(false), true)
    assert.equal(queue.getSnapshot().draft.description, "Someone else's edit")
    assert.equal(saved.read(), null)
    queue.stop()
})

test("commercial drafts restore without dispatch, and explicit acknowledgement retains later typing", async () => {
    const saved = storage()
    let sends = 0
    const queue = new RelationshipDraftQueue(initial, v1, async (command) => { sends++; return { ok: true, version: v2, values: command.values } }, "command", 100_000)
    queue.attachStorage(saved)
    queue.edit((draft) => ({ ...draft, selectedCodes: ["design"], upfrontPrices: { design: 12345 } }))
    assert.equal(await queue.flush(), true)
    assert.equal(sends, 0)
    assert.equal(queue.checkpoint(), true)
    const source = queue.getSnapshot().draft
    const release = queue.hold()!
    queue.edit((draft) => ({ ...draft, currency: "EUR" }))
    assert.equal(await queue.flush(), false)
    assert.equal(queue.acknowledgeCommercial(source, v2), true)
    release()
    assert.equal(queue.getSnapshot().draft.currency, "EUR")
    assert.equal(saved.read()?.baseline.currency, "USD")
    queue.stop()
    const recovered = new RelationshipDraftQueue(source, v2, async () => { throw new Error("Unexpected background write") })
    recovered.attachStorage(saved)
    assert.equal(recovered.getSnapshot().draft.currency, "EUR")
    recovered.stop()
})

test("storage denial blocks checkpoint; stopping suppresses late writes and next sends", async () => {
    let finish!: () => void
    let writes = 0
    const queue = new RelationshipDraftQueue(initial, v1, async (command) => { await new Promise<void>((resolve) => { finish = resolve }); return { ok: true, version: v2, values: command.values } }, "command", 100_000)
    queue.attachStorage({ read: () => null, write: () => { writes++; throw new Error("Quota") } })
    queue.edit((draft) => ({ ...draft, description: "Keep this" }))
    assert.equal(queue.checkpoint(), false)
    const pending = queue.flush()
    const before = writes
    queue.stop()
    finish()
    assert.equal(await pending, false)
    assert.equal(writes, before)
})

test("draft restoration rejects malformed commands and preserves account/CSRF boundaries", () => {
    const values = { ...initial }
    const command = { requestId: "00000000-0000-4000-8000-000000000001", expectedUserId: "00000000-0000-4000-8000-000000000002", expectedUpdatedAt: v1, values }
    assert.equal(parseRelationshipBackgroundCommand(command), null, "Commercial fields are forbidden in the background command")
    const stored = { version: v1, baseline: initial, draft: { ...initial, currency: "EUR" }, conflict: false }
    assert.equal(parsePersistedRelationshipDraft(stored)?.draft.currency, "EUR")
    assert.equal(parsePersistedRelationshipDraft({ ...stored, pending: { requestId: "invalid" } }), null)
    assert.equal(relationshipBackgroundCommandIsSameOrigin(new Request("https://be.test/api", { headers: { origin: "https://be.test" } })), true)
    assert.equal(relationshipBackgroundCommandIsSameOrigin(new Request("https://be.test/api", { headers: { origin: "https://evil.test" } })), false)
    assert.equal(relationshipBackgroundCommandIsSameOrigin(new Request("https://be.test/api")), false)
})

function memoryStorage(): Storage {
    const values = new Map<string, string>()
    return { get length() { return values.size }, key: (index) => [...values.keys()][index] ?? null, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: (key) => { values.delete(key) }, clear: () => values.clear() }
}

test("browser windows keep independent journals and foreign draft recovery requires review", () => {
    const local = memoryStorage(), sessionOne = memoryStorage(), sessionTwo = memoryStorage()
    const first = createRelationshipDraftStorage(local, sessionOne, "betelgeze:relationship-draft:user:workspace:record")
    first.write({ version: v1, baseline: initial, draft: { ...initial, currency: "EUR" }, conflict: false })
    const second = createRelationshipDraftStorage(local, sessionTwo, "betelgeze:relationship-draft:user:workspace:record")
    assert.equal(second.read()?.conflict, true)
    second.write({ version: v1, baseline: initial, draft: { ...initial, currency: "GBP" }, conflict: false })
    assert.equal(first.read()?.draft.currency, "EUR")
    assert.equal(second.read()?.draft.currency, "GBP")
    assert.equal(createRelationshipDraftStorage(local, sessionOne, "betelgeze:relationship-draft:user:workspace:record").read()?.draft.currency, "EUR", "Reload restores its own browser journal")
    assert.equal(createRelationshipDraftStorage(local, memoryStorage(), "betelgeze:relationship-draft:other-user:workspace:record").read(), null)
    second.write(null)
    assert.equal(first.read()?.draft.currency, "EUR", "One window never clears another window's unsaved work")
})
