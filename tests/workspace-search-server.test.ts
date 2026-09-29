import assert from "node:assert/strict"
import test from "node:test"
import { withSearchDeadline } from "../lib/workspace-search-server.ts"

test("deadline rejects a hanging operation and cancels its signal", async () => {
    let observed: AbortSignal | undefined
    await assert.rejects(withSearchDeadline(new AbortController().signal, (signal) => { observed = signal; return new Promise(() => {}) }, 10), { name: "TimeoutError" })
    assert.equal(observed?.aborted, true)
})

test("already cancelled searches never start work", async () => {
    const cancelled = new AbortController(); cancelled.abort()
    let started = false
    await assert.rejects(withSearchDeadline(cancelled.signal, async () => { started = true }), { name: "AbortError" })
    assert.equal(started, false)
})

test("superseding a search releases the caller even when transport ignores abort", async () => {
    const source = new AbortController()
    let observed: AbortSignal | undefined
    const pending = withSearchDeadline(source.signal, (signal) => { observed = signal; return new Promise(() => {}) })
    source.abort()
    await assert.rejects(pending, { name: "AbortError" })
    assert.equal(observed?.aborted, true)
})

test("successful and failed searches clean up their remaining deadline work", async () => {
    for (const fail of [false, true]) {
        let observed: AbortSignal | undefined
        const pending = withSearchDeadline(new AbortController().signal, async signal => {
            observed = signal
            if (fail) throw new Error("Synthetic failure")
            return 42
        })
        if (fail) await assert.rejects(pending, /Synthetic failure/)
        else assert.equal(await pending, 42)
        assert.equal(observed?.aborted, true)
    }
})
