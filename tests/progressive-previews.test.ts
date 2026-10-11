import assert from "node:assert/strict"
import test from "node:test"
import { confirmedPreviewCursor, createProgressivePreviewQueue } from "../lib/communications/progressive-previews.ts"

const settled = () => new Promise(resolve => setImmediate(resolve))
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const item = (conversationId: string) => ({ conversationId })

test("only visible previews enter one lane in batches of at most20", async () => {
    const calls: string[][] = [], pending = deferred<Array<{ conversationId: string }>>()
    const ids = Array.from({ length: 45 }, (_, i) => `c${i}`)
    const queue = createProgressivePreviewQueue({ request: async requested => { calls.push(requested); return calls.length === 1 ? pending.promise : requested.map(item) }, apply() {}, failed() {} })
    queue.setVisible(ids); await settled(); assert.equal(calls.length, 0)
    queue.setActive(true); queue.setVisible(ids); assert.equal(calls.length, 1); assert.equal(calls[0].length, 20)
    pending.resolve(calls[0].map(item)); await settled()
    assert.deepEqual(calls.map(ids => ids.length), [20, 20, 5]); assert.equal(new Set(calls.flat()).size, 45)
    queue.dispose()
})

test("synchronous visibility challenge during apply cannot duplicate completed previews", async () => {
    let requests = 0
    const queue = createProgressivePreviewQueue({ request: async ids => { requests++; return ids.map(item) }, apply() { for (let i = 0; i < 20; i++) queue.setVisible(["a", "b"]) }, failed() {} })
    queue.setVisible(["a", "b"]); queue.setActive(true); await settled()
    assert.equal(requests, 1); queue.dispose()
})

test("refresh during request rejects stale completion then services newer generation", async () => {
    const pending = deferred<Array<{ conversationId: string }>>(); const applied: string[][] = []; let requests = 0
    const queue = createProgressivePreviewQueue({ request: async ids => ++requests === 1 ? pending.promise : ids.map(item), apply: items => applied.push(items.map(item => item.conversationId)), failed() {} })
    queue.setVisible(["a"]); queue.setActive(true); queue.invalidate(["a"])
    pending.resolve([item("a")]); await settled()
    assert.equal(requests, 2); assert.deepEqual(applied, [["a"]]); queue.dispose()
})

test("failed and missing previews remain explicit and only retry on new intent", async () => {
    const calls: string[][] = [], failures: string[][] = []
    const queue = createProgressivePreviewQueue({ request: async ids => { calls.push(ids); return calls.length === 1 ? [item("a")] : ids.map(item) }, apply() {}, failed: ids => failures.push(ids) })
    queue.setVisible(["a", "b"]); queue.setActive(true); await settled(); queue.setVisible(["a", "b"]); await settled()
    assert.deepEqual(failures, [["b"]]); assert.equal(calls.length, 1)
    queue.retry("b"); await settled(); assert.deepEqual(calls, [["a", "b"], ["b"]]); queue.dispose()
})

test("hidden or disposed owners cannot apply stale completions or run background follow-ups", async () => {
    const pending = deferred<Array<{ conversationId: string }>>(); let applies = 0; let requests = 0
    const queue = createProgressivePreviewQueue({ request: async () => { requests++; return pending.promise }, apply() { applies++ }, failed() { assert.fail("aborted work is not a visible failure") } })
    queue.setVisible(["a"]); queue.setActive(true); queue.setActive(false); pending.resolve([item("a")]); await settled()
    assert.equal(applies, 0); assert.equal(requests, 1)
    queue.dispose(); queue.setActive(true); await settled(); assert.equal(requests, 1)
})

test("covered mobile list resumes once with its retained preview admission", async () => {
    const aborted = deferred<Array<{ conversationId: string }>>(); let requests = 0
    const queue = createProgressivePreviewQueue({ initialReady: ["warm"], request: async ids => ++requests === 1 ? aborted.promise : ids.map(item), apply() {}, failed() { assert.fail("covered cancellation must remain retryable") } })
    queue.setVisible(["warm", "cold"]); queue.setActive(true); queue.setActive(false)
    aborted.resolve([item("cold")]); await settled(); assert.equal(requests, 1)
    queue.setActive(true); await settled(); assert.equal(requests, 2)
    queue.setVisible(["warm", "cold"]); await settled(); assert.equal(requests, 2)
    queue.dispose()
})


test("confirmed empty cursor differs from missing or malformed cursor metadata", () => {
    assert.equal(confirmedPreviewCursor(null), true)
    assert.equal(confirmedPreviewCursor(undefined), false)
    assert.equal(confirmedPreviewCursor({ lastReadAt: "not a timestamp", lastReadMessageId: null }), false)
    assert.equal(confirmedPreviewCursor({ lastReadAt: "2026-10-11T10:00:00.123456Z" }), false)
    const value = { lastReadAt: "2026-10-11T10:00:00.123456Z", lastReadMessageId: "00000000-0000-4000-8000-000000000001" }
    assert.equal(confirmedPreviewCursor(value), true)
    assert.equal(value.lastReadAt, "2026-10-11T10:00:00.123456Z", "validation retains the exact microsecond boundary")
})

test("a late batch cannot overwrite a newer preview confirmed with selected history", async () => {
    const pending = deferred<Array<{ conversationId: string; body: string }>>()
    const applied: string[] = []
    const queue = createProgressivePreviewQueue({ request: () => pending.promise, apply: items => applied.push(...items.map(item => item.conversationId)), failed() { assert.fail("selected history already confirmed this preview") } })
    queue.setVisible(["selected", "other"]); queue.setActive(true)
    queue.confirm(["selected"])
    pending.resolve([{ conversationId: "selected", body: "older message" }, { conversationId: "other", body: "current message" }]); await settled()
    assert.deepEqual(applied, ["other"])
    queue.dispose()
})

test("failed batch cannot turn a separately confirmed selected preview into an error", async () => {
    const pending = deferred<Array<{ conversationId: string }>>()
    const failed: string[][] = []
    const queue = createProgressivePreviewQueue({ request: () => pending.promise, apply() {}, failed: ids => failed.push(ids) })
    queue.setVisible(["selected", "other"]); queue.setActive(true); queue.confirm(["selected"])
    pending.reject(new Error("offline")); await settled()
    assert.deepEqual(failed, [["other"]]); queue.dispose()
})
