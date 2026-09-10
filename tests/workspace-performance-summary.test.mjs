import assert from "node:assert/strict"
import test from "node:test"
import { nearestRank, summarize } from "../scripts/summarize-workspace-performance.mjs"

test("performance summaries retain failures, cache conditions and missing boundaries", () => {
    const sample = { operation: "navigation", cacheState: "memory", renderer: "native", durationMs: 100, startedVisible: true, endedVisible: true, visibilityChanges: 0, outcome: "completed", boundaries: { meaningful_ready: 100 } }
    const summary = summarize([sample, { ...sample, outcome: "failed", boundaries: {} }, { ...sample, cacheState: "network", durationMs: 900, boundaries: { meaningful_ready: 900 } }])
    assert.equal(summary.groups.length, 2)
    assert.equal(summary.groups[0].outcomes.failed, 1)
    assert.deepEqual(summary.groups[0].boundaries.meaningful_ready, { count: 1, missing: 1, p50: 100, p95: 100 })
    assert.equal(summary.groups[1].boundaries.meaningful_ready.p95, 900)
    assert.equal(nearestRank([], .95), null)
    assert.equal(nearestRank([1, 2, 3, 4, 100], .95), 100)
})
