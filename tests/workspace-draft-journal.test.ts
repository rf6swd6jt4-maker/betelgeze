import assert from "node:assert/strict"
import test from "node:test"
import { createWorkspaceDraftJournal, workspaceDraftJournalPrefix, type WorkspaceDraftScope } from "../lib/workspace-draft-journal.ts"

const scope = (id: string): WorkspaceDraftScope => ({ userId: "actor", workspaceSlug: "workspace", recordType: "note", recordId: id, field: "description" })
const value = (text: string, baseline = "Saved") => ({ value: text, baseline, version: "v1" })
function device() {
    const records = new Map<string, string>()
    let denied = false, reads = 0, writes = 0, enumerations = 0
    const storage = {
        get length() { return records.size },
        key(index: number) { enumerations++; return [...records.keys()][index] ?? null },
        getItem(key: string) { reads++; if (denied) throw Error("SecurityError"); return records.get(key) ?? null },
        setItem(key: string, raw: string) { writes++; if (denied) throw Error("QuotaExceededError"); records.set(key, raw) },
        removeItem(key: string) { if (denied) throw Error("SecurityError"); records.delete(key) },
    }
    return { records, storage, deny: (next: boolean) => { denied = next }, counts: () => ({ reads, writes, enumerations }) }
}

test("clean owners and unchanged checkpoints do no storage work; late input replaces only this writer", async () => {
    const d = device(), journal = createWorkspaceDraftJournal(scope("cost"), { storage: () => d.storage })
    assert.equal(journal.checkpoint(value("Saved")), true)
    assert.deepEqual(d.counts(), { reads: 0, writes: 0, enumerations: 0 })
    assert.equal(journal.checkpoint(value("Departure")), true)
    assert.equal(d.counts().writes, 2)
    assert.equal(journal.checkpoint(value("Departure")), true)
    assert.equal(d.counts().writes, 2)
    assert.equal(journal.checkpoint(value("After departure acknowledgement")), true)
    assert.equal(d.counts().writes, 3)
    assert.deepEqual((await journal.review()).drafts.map((draft) => draft.value), ["After departure acknowledgement"])
})

test("fresh writers isolate duplicated sessions; acknowledging one never clears another or its hint", async () => {
    const d = device(), identity = scope("writers")
    const a = createWorkspaceDraftJournal(identity, { storage: () => d.storage })
    const b = createWorkspaceDraftJournal(identity, { storage: () => d.storage })
    a.checkpoint(value("Window A")); b.checkpoint(value("Window B"))
    assert.equal((await a.review()).drafts.length, 2)
    a.acknowledge(value("Window A", "Window A"))
    assert.deepEqual((await b.review()).drafts.map((draft) => draft.value), ["Window B"])
    assert.equal(d.records.get(`${workspaceDraftJournalPrefix(identity)}hint`), "1")
    for (const other of [{ ...identity, userId: "other" }, { ...identity, workspaceSlug: "other" }, { ...identity, recordType: "sop" }, { ...identity, field: "name" }]) {
        assert.deepEqual((await createWorkspaceDraftJournal(other, { storage: () => d.storage }).review()).drafts, [])
    }
})

test("denied storage retains the latest owner but successful storage does not duplicate durable drafts in memory", async () => {
    const d = device(), journal = createWorkspaceDraftJournal(scope("denied"), { storage: () => d.storage })
    d.deny(true)
    assert.equal(journal.checkpoint(value("Last input")), false)
    const failed = await journal.review()
    assert.equal(failed.drafts[0].value, "Last input"); assert.equal(failed.drafts[0].durable, false)
    d.deny(false)
    assert.equal(journal.checkpoint(value("Last input")), true)
    d.records.clear(); d.deny(true)
    assert.deepEqual((await journal.review()).drafts, [], "durable copies must not accumulate a second full RAM copy")
})

test("unreadable foreign journals survive explicit review, recovery and local acknowledgement", async () => {
    const d = device(), identity = scope("unreadable"), prefix = workspaceDraftJournalPrefix(identity)
    d.records.set(`${prefix}older`, "{bad json")
    const journal = createWorkspaceDraftJournal(identity, { storage: () => d.storage })
    journal.checkpoint(value("My current edit"))
    journal.archive(value("My current edit"))
    journal.checkpoint(value("Recovered edit"))
    journal.acknowledge(value("Recovered edit", "Recovered edit"))
    const review = await journal.review()
    assert.ok(review.error)
    assert.equal(d.records.get(`${prefix}older`), "{bad json")
    assert.deepEqual(review.drafts.map((draft) => draft.value), ["My current edit"])
})

test("mount hint lookup is exact and explicit recovery has a finite sliced pass despite concurrent growth", async () => {
    const d = device(), identity = scope("bounded"), prefix = workspaceDraftJournalPrefix(identity)
    for (let index = 0; index < 60; index++) d.records.set(`other:${index}`, "unrelated")
    d.records.set(`${prefix}hint`, "1")
    let yields = 0
    const journal = createWorkspaceDraftJournal(identity, { storage: () => d.storage, yieldTask: async () => { yields++; for (let index = 0; index < 100; index++) d.records.set(`growth:${yields}:${index}`, "unrelated") } })
    assert.equal(journal.inspectRecovery(), true)
    assert.deepEqual(d.counts(), { reads: 1, writes: 0, enumerations: 0 })
    assert.deepEqual((await journal.review()).drafts, [])
    assert.equal(d.counts().enumerations, 61)
    assert.equal(yields, 2)
    const controller = new AbortController(); controller.abort()
    await assert.rejects(journal.review(controller.signal), { name: "AbortError" })
})

test("stopped account owners cannot write or retire drafts and oversized copies remain recoverable in the open page", async () => {
    const d = device(), journal = createWorkspaceDraftJournal(scope("stopped"), { storage: () => d.storage, maximum: 10 })
    assert.equal(journal.checkpoint(value("Too long to persist")), false)
    assert.equal(d.counts().writes, 0)
    assert.equal((await journal.review()).drafts[0].durable, false)
    journal.stop()
    assert.equal(journal.checkpoint(value("New")), false)
    journal.acknowledge(value("Saved"))
    assert.equal((await journal.review()).drafts[0].value, "Too long to persist")
})

test("server acknowledgement preserves newer late input and retires only an exactly clean own copy", async () => {
    const d = device(), journal = createWorkspaceDraftJournal(scope("ack"), { storage: () => d.storage })
    journal.checkpoint(value("Submitted"))
    journal.acknowledge({ value: "Typed later", baseline: "Submitted", version: "v2" })
    const draft = (await journal.review()).drafts[0]
    assert.equal(draft.value, "Typed later"); assert.equal(draft.baseline, "Submitted"); assert.equal(draft.version, "v2")
    journal.acknowledge({ value: "Typed later", baseline: "Typed later", version: "v3" })
    assert.deepEqual((await journal.review()).drafts, [])
})
