import test from "node:test"
import assert from "node:assert/strict"
import { createAttachmentPageCache, createAttachmentReadOwner } from "../lib/attachment-reads.ts"
import { attachmentPageRows, decodeAttachmentCursor, encodeAttachmentCursor, attachmentSearch } from "../lib/attachment-pages.ts"

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
test("attachment reads deduplicate, fence a late pre-write read and release the slot", async () => {
    const before = deferred<string>(), after = deferred<string>(); let calls = 0
    const owner = createAttachmentReadOwner(key => { calls++; return key === "before" ? before.promise : after.promise })
    const old = owner.read("before"); assert.equal(owner.read("before"), old)
    owner.cancel()
    const current = owner.read("after"); after.resolve("saved link")
    assert.equal(await current, "saved link"); before.resolve("stale empty page")
    assert.equal(await old, undefined); assert.equal(calls, 2)
    assert.equal(await owner.read("after"), "saved link"); assert.equal(calls, 3)
})
test("deadline covers stuck response parsing and permits explicit retry without auto retry", async () => {
    let calls = 0, aborted = false
    const owner = createAttachmentReadOwner(async (_key, signal) => { calls++; signal.addEventListener("abort", () => { aborted = true }); if (calls === 1) return new Promise<string>(() => {}); return "retry" }, 5)
    await assert.rejects(owner.read("page"), /too long/)
    assert.equal(calls, 1); assert.equal(aborted, true)
    assert.equal(await owner.read("page"), "retry")
})
test("cursor pages reach records beyond old cutoff and preserve microsecond ties", () => {
    const rows = Array.from({ length: 125 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(1000 - i).padStart(12, "0")}`, at: "2026-09-23T10:00:00.123456+00:00" }))
    const seen = []
    let remaining = rows
    while (remaining.length) {
        const page = attachmentPageRows(remaining.slice(0, 21)); seen.push(...page.items)
        if (!page.next) break
        const token = encodeAttachmentCursor({ asset: page.next, note: null })
        assert.deepEqual(decodeAttachmentCursor(token), { asset: page.next, note: null })
        remaining = remaining.filter(row => row.id < page.next!.id)
    }
    assert.equal(new Set(seen.map(row => row.id)).size, 125)
    assert.equal(encodeAttachmentCursor({ asset: null, note: null }), null)
})
test("cursor and search values cannot inject PostgREST filters or wildcards", () => {
    const injection = Buffer.from(JSON.stringify({ asset: { id: "x),workspace_id.neq.x", at: "now" }, note: null })).toString("base64url")
    assert.throws(() => decodeAttachmentCursor(injection), /Invalid/)
    assert.throws(() => decodeAttachmentCursor("x".repeat(1201)), /Invalid/)
    assert.equal(attachmentSearch("  invoice_100%  "), "invoice\\_100\\%")
    assert.throws(() => attachmentSearch("x".repeat(121)), /120/)
})
test("remounting a retained last page keeps its incoming cursor and newest navigation", () => {
    const cache = createAttachmentPageCache<{ items: string[]; nextCursor: string | null }>(2)
    cache.set("actor:workspace:record", { items: ["last attachment"], nextCursor: null }, "incoming-last-page")
    const restored = cache.get("actor:workspace:record")!
    assert.equal(restored.cursor, "incoming-last-page"); assert.equal(restored.page.nextCursor, null)
    assert.equal(Boolean(restored.cursor || restored.page.nextCursor), true)
    cache.set("actor:workspace:record", { items: ["newest attachment"], nextCursor: "older" }, null)
    assert.equal(cache.get("actor:workspace:record")!.cursor, null)
    cache.set("second", { items: [], nextCursor: null }, null); cache.set("third", { items: [], nextCursor: null }, null)
    assert.equal(cache.get("actor:workspace:record"), undefined)
})
test("late choices failure cannot replace the current result", async () => {
    let fail!: (error: Error) => void
    const owner = createAttachmentReadOwner(key => key === "old" ? new Promise<string>((_, reject) => { fail = reject }) : Promise.resolve("current choices"))
    const old = owner.read("old"), current = owner.read("new")
    assert.equal(await current, "current choices"); fail(new Error("Old failed search"))
    assert.equal(await old, undefined)
})
