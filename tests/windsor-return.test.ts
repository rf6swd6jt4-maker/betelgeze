import assert from "node:assert/strict"
import test from "node:test"
import { createWindsorReturnMonitor } from "../lib/onboarding/windsor-return.ts"

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))
test("close/focus signals coalesce and propagation retries stop at success", async () => {
    let calls = 0, settled = 0
    const monitor = createWindsorReturnMonitor({ visible: () => true, delays: [1, 1], settled: () => { settled++ }, verify: async () => { calls++; await tick(); return calls === 1 ? "retry" : "complete" } })
    monitor.start(); monitor.returned(); monitor.returned(); monitor.returned()
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.equal(calls, 2); assert.equal(settled, 1)
    monitor.returned(); await tick(); assert.equal(calls, 2)
    monitor.dispose()
})
test("empty responses have a finite retry budget and resume on a later return", async () => {
    let calls = 0
    const monitor = createWindsorReturnMonitor({ visible: () => true, delays: [1, 1], settled() {}, verify: async () => { calls++; return "retry" } })
    monitor.start(); monitor.returned(); await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(calls, 3)
    monitor.returned(); await new Promise((resolve) => setTimeout(resolve, 50)); assert.equal(calls, 6)
    monitor.dispose()
})
test("hidden pages wait for a visible return, and disposal rejects late work", async () => {
    let visible = false, calls = 0, settled = 0
    const monitor = createWindsorReturnMonitor({ visible: () => visible, delays: [1], settled: () => { settled++ }, verify: async () => { calls++; await tick(); return "retry" } })
    monitor.start(); monitor.returned(); await tick(); assert.equal(calls, 0)
    visible = true; monitor.returned(); monitor.dispose(); await tick(); await tick()
    assert.equal(calls, 1); assert.equal(settled, 0)
})
test("provider failures pause retries but a later window close can recover", async () => {
    let calls = 0
    const monitor = createWindsorReturnMonitor({ visible: () => true, delays: [1], settled() {}, verify: async () => { calls++; return calls === 1 ? "pause" : "complete" } })
    monitor.start(); monitor.returned(); await tick(); assert.equal(calls, 1)
    monitor.returned(); await tick(); assert.equal(calls, 2)
    monitor.dispose()
})

test("staff authorization return observes close and focus without hidden polling or leaked listeners", async () => {
    const { observeWindsorReturn } = await import("../lib/onboarding/windsor-return.ts")
    const host = new EventTarget()
    const page = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState, hasFocus: () => false })
    const popup = { closed: false }
    let calls = 0
    const stop = observeWindsorReturn({ popup: () => popup, returned: () => { calls++ }, host: host as unknown as Window, page: page as unknown as Document })
    assert.equal(calls, 0, "opening a popup is not a completed authorization")
    page.visibilityState = "hidden"; page.dispatchEvent(new Event("visibilitychange"))
    popup.closed = true
    host.dispatchEvent(new Event("focus")); assert.equal(calls, 0)
    page.visibilityState = "visible"; page.dispatchEvent(new Event("visibilitychange"))
    assert.ok(calls >= 1)
    const afterReturn = calls
    host.dispatchEvent(new Event("focus")); assert.equal(calls, afterReturn)
    stop(); host.dispatchEvent(new Event("blur")); host.dispatchEvent(new Event("focus")); assert.equal(calls, afterReturn)
})

test("expired authorization observations stop before triggering another provider check", async () => {
    const { observeWindsorReturn } = await import("../lib/onboarding/windsor-return.ts")
    const host = new EventTarget(), page = Object.assign(new EventTarget(), { visibilityState: "visible", hasFocus: () => false })
    let calls = 0
    const stop = observeWindsorReturn({ popup: () => ({ closed: true }), returned: () => { calls++ }, host: host as unknown as Window, page: page as unknown as Document, durationMs: 0 })
    host.dispatchEvent(new Event("focus")); assert.equal(calls, 0); stop()
})
