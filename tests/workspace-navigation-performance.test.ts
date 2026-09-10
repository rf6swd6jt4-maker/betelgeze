import assert from "node:assert/strict"
import test from "node:test"
import { createWorkspacePerformanceMeasurement, WorkspaceNavigationPerformanceTracker, type WorkspacePerformanceSample } from "../lib/workspace-performance-contract.ts"

function fixture() {
    let now = 0
    let nextId = 0
    const samples: WorkspacePerformanceSample[] = []
    const tracker = new WorkspaceNavigationPerformanceTracker()
    const handle = (operation: "navigation" | "tab_switch" = "navigation") => {
        const measurement = createWorkspacePerformanceMeasurement({ sampleId: `6801c9bd-cfea-4460-8ef7-${String(++nextId).padStart(12, "0")}`, operation, routeSection: "relationships", renderer: "native", cacheState: "memory" }, () => now, true)
        return { mark: measurement.mark, finish: (...args: Parameters<typeof measurement.finish>) => { const sample = measurement.finish(...args); if (sample) samples.push(sample) } }
    }
    return { tracker, samples, handle, at: (value: number) => { now = value } }
}

test("native navigation includes saving and loading until the exact destination paints", () => {
    const { tracker, samples, handle, at } = fixture()
    const intent = tracker.begin(handle(), "/private/relationships/record", null)
    at(420) // awaiting durable save before a destination tab exists
    tracker.bind(intent, "new-tab")
    tracker.ready("old-tab", "/private/relationships/record")
    tracker.ready("new-tab", "/private/relationships")
    assert.equal(samples.length, 0, "neither an old tab nor its shell location handshake establishes readiness")
    at(615)
    tracker.ready("new-tab", "/private/relationships/record")
    assert.equal(samples[0].durationMs, 615)
    assert.equal(samples[0].boundaries.meaningful_ready, 615)
    assert.equal(samples[0].completionBoundary, "meaningful_ready")
    assert.equal(JSON.stringify(samples).includes("/private/"), false, "correlation URLs never enter telemetry")
    tracker.ready("new-tab", "/private/relationships/record")
    assert.equal(samples.length, 1)
})

test("superseded navigation is aborted and late cancellation cannot stop the next intent", () => {
    const { tracker, samples, handle, at } = fixture()
    tracker.begin(handle(), "/one", "tab", { tabId: "tab", sequence: 1 })
    at(25)
    tracker.begin(handle(), "/two", "tab", { tabId: "tab", sequence: 2 })
    tracker.finishSource("tab", 1, "failed")
    tracker.ready("tab", "/one")
    assert.equal(samples.length, 1)
    assert.equal(samples[0].outcome, "aborted")
    at(90)
    tracker.ready("tab", "/two")
    assert.equal(samples[1].durationMs, 65)
    assert.equal(samples[1].outcome, "completed")
})

test("canonical redirect preserves the original input clock and ignores intermediate readiness", () => {
    const { tracker, samples, handle, at } = fixture()
    tracker.begin(handle(), "/admin/okrs/record", "tab")
    at(200)
    tracker.retarget("tab", "/admin/okrs#okr-record", { tabId: "tab", sequence: 1 })
    tracker.ready("tab", "/admin/okrs/record")
    assert.equal(samples.length, 0)
    at(330)
    tracker.ready("tab", "/admin/okrs#okr-record")
    assert.equal(samples[0].durationMs, 330)
})

test("blocked durability, failed loading and leaving a tab cannot become successful samples", () => {
    const { tracker, samples, handle } = fixture()
    const blocked = tracker.begin(handle(), "/blocked", "tab")
    tracker.finish(blocked, "failed")
    tracker.begin(handle(), "/failed", "tab")
    tracker.finishTarget("tab", "/failed", "failed")
    tracker.begin(handle("tab_switch"), "/other", "other")
    tracker.activate("away")
    tracker.ready("other", "/other")
    assert.deepEqual(samples.map((sample) => sample.outcome), ["failed", "failed", "aborted"])
    assert.ok(samples.every((sample) => sample.boundaries.meaningful_ready === undefined))
})
