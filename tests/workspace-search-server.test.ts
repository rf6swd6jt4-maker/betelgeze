import assert from "node:assert/strict"
import test from "node:test"
import { createSearchReader, withSearchDeadline } from "../lib/workspace-search-server.ts"

const turn = () => new Promise<void>((resolve) => setImmediate(resolve))
function reads() {
    let active = 0, peak = 0
    const started: number[] = [], signals: AbortSignal[] = []
    const releases = new Map<number, (error?: unknown) => void>()
    const query = (id: number) => ({ abortSignal(signal: AbortSignal) {
        started.push(id); signals.push(signal); active++; peak = Math.max(peak, active)
        return new Promise<{ data: number[] | null; error: unknown }>((resolve, reject) => {
            let settled = false
            const finish = (error?: unknown) => {
                if (settled) return
                settled = true; active--; releases.delete(id); signal.removeEventListener("abort", abort)
                if (signal.aborted) reject(signal.reason)
                else resolve({ data: error ? null : [id], error: error ?? null })
            }
            const abort = () => finish(signal.reason)
            signal.addEventListener("abort", abort, { once: true }); releases.set(id, finish)
        })
    } })
    return { query, started, signals, releases, get peak() { return peak }, get active() { return active } }
}

test("deadline rejects a hanging operation and cancels its signal", async () => {
    let observed: AbortSignal | undefined
    await assert.rejects(withSearchDeadline(new AbortController().signal, (signal) => { observed = signal; return new Promise(() => {}) }, 10), { name: "TimeoutError" })
    assert.equal(observed?.aborted, true)
})

test("already cancelled and superseded searches cannot keep running", async () => {
    const cancelled = new AbortController(); cancelled.abort()
    let started = false
    await assert.rejects(withSearchDeadline(cancelled.signal, async () => { started = true }), { name: "AbortError" })
    assert.equal(started, false)
    const old = new AbortController(), fixture = reads()
    const pending = withSearchDeadline(old.signal, (signal) => createSearchReader(signal)(fixture.query(1)))
    old.abort()
    await assert.rejects(pending, { name: "AbortError" })
    assert.equal(fixture.active, 0)
    assert.ok(fixture.signals.every(signal => signal.aborted))
})

test("read slots stay bounded when new work arrives while a queued read takes a released slot", async () => {
    const fixture = reads(), read = createSearchReader(new AbortController().signal)
    const pending = Array.from({ length: 10 }, (_, id) => read(fixture.query(id)))
    assert.equal(fixture.started.length, 7)
    fixture.releases.get(0)!()
    pending[0].then(() => pending.push(read(fixture.query(10))))
    for (let i = 0; i < 8 && fixture.started.length < 11; i++) {
        await turn()
        for (const release of [...fixture.releases.values()]) release()
    }
    await Promise.all(pending)
    assert.equal(fixture.started.length, 11)
    assert.equal(fixture.peak, 7)
    assert.equal(fixture.active, 0)
})

test("one failed category aborts running siblings and never dispatches queued categories", async () => {
    const fixture = reads(), read = createSearchReader(new AbortController().signal)
    const pending = Promise.all(Array.from({ length: 12 }, (_, id) => read(fixture.query(id))))
    fixture.releases.get(0)!({ message: "Synthetic category failure" })
    await assert.rejects(pending, /Search read unavailable/)
    await turn()
    assert.equal(fixture.started.length, 7)
    assert.equal(fixture.active, 0)
    assert.ok(fixture.signals.every(signal => signal.aborted))
})


test("cancellation releases queued callers even when active transports ignore abort", async () => {
    const source = new AbortController(), read = createSearchReader(source.signal)
    let started = 0
    const ignoresAbort = { abortSignal() { started++; return new Promise<{ data: number[]; error: null }>(() => {}) } }
    for (let i = 0; i < 7; i++) void read(ignoresAbort).catch(() => {})
    const queued = Promise.allSettled([read(ignoresAbort), read(ignoresAbort), read(ignoresAbort)])
    source.abort()
    const outcomes = await queued
    assert.equal(started, 7)
    assert.ok(outcomes.every(outcome => outcome.status === "rejected"))
})
