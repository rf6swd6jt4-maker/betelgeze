import assert from "node:assert/strict"
import test from "node:test"
import { createWorkspacePerformanceMeasurement, sanitizeWorkspacePerformanceSample } from "../lib/workspace-performance-contract.ts"

const id = "6801c9bd-cfea-4460-8ef7-b6e738494fa2"
function fixture(visible = true) {
    let now = 100
    const measurement = createWorkspacePerformanceMeasurement({ sampleId: id, operation: "navigation", routeSection: "relationships", cacheState: "memory", renderer: "native" }, () => now, visible)
    return { measurement, at: (time: number) => { now = 100 + time } }
}

test("the first meaningful boundary is retained and completion cannot be confused with response headers", () => {
    const { measurement, at } = fixture()
    at(20)
    measurement.mark("data_ready")
    at(35)
    measurement.mark("meaningful_ready")
    at(50)
    measurement.mark("meaningful_ready")
    const result = measurement.finish("completed", "meaningful_ready")
    assert.equal(result?.boundaries.meaningful_ready, 35)
    assert.equal(result?.boundaries.data_ready, 20)
    assert.equal(result?.boundaries.server_ack, undefined)
    assert.equal(result?.durationMs, 50)
    assert.equal(measurement.finish("completed", "meaningful_ready"), null)
    assert.equal(fixture().measurement.finish("completed", "server_ack"), null)
})

test("durability, visual feedback and server acknowledgement are independently measured", () => {
    const { measurement, at } = fixture()
    at(8); measurement.mark("visual_response")
    at(15); measurement.mark("local_persisted")
    at(580); measurement.mark("server_ack")
    const result = measurement.finish("completed", "server_ack")
    assert.equal(result?.boundaries.external_completed, undefined)
    assert.deepEqual(result?.boundaries, { visual_response: 8, local_persisted: 15, server_ack: 580 })
})

test("hidden and frozen intervals remain visible instead of being subtracted from latency", () => {
    const { measurement, at } = fixture()
    at(10); measurement.visibility(false)
    at(500); measurement.suspend()
    at(900); measurement.visibility(true)
    at(950); measurement.mark("meaningful_ready")
    const result = measurement.finish("completed", "meaningful_ready")
    assert.equal(result?.durationMs, 950)
    assert.equal(result?.hiddenDurationMs, 890)
    assert.equal(result?.visibilityChanges, 2)
    assert.equal(result?.suspended, true)
    assert.equal(result?.startedVisible, true)
    assert.equal(result?.endedVisible, true)
})

test("aborted, failed and timed-out measurements retain missing boundary information", () => {
    for (const outcome of ["failed", "aborted", "timeout"] as const) {
        const { measurement, at } = fixture(false)
        at(300)
        const result = measurement.finish(outcome)
        assert.equal(result?.outcome, outcome)
        assert.equal(result?.completionBoundary, null)
        assert.equal(result?.hiddenDurationMs, 300)
        assert.deepEqual(result?.boundaries, {})
    }
})

test("ingestion rejects invalid intervals and discards all unrecognised or sensitive fields", () => {
    const { measurement, at } = fixture()
    at(100)
    const sample = measurement.finish("failed")!
    const cleaned = sanitizeWorkspacePerformanceSample({ ...sample, token: "secret", route: "/customer/private-name", error: "private", command: "send-to-private-person", boundaries: { data_ready: 20, server_ack: 101, customer: 2 } })
    assert.equal(cleaned?.command, "unknown")
    assert.deepEqual(cleaned?.boundaries, { data_ready: 20 })
    assert.equal("token" in cleaned!, false)
    assert.equal("route" in cleaned!, false)
    assert.equal("error" in cleaned!, false)
    assert.equal(sanitizeWorkspacePerformanceSample({ ...sample, sampleId: "not-a-uuid" }), null)
    assert.equal(sanitizeWorkspacePerformanceSample({ ...sample, operation: "private-name" }), null)
    assert.equal(sanitizeWorkspacePerformanceSample({ ...sample, durationMs: Infinity }), null)
    assert.equal(sanitizeWorkspacePerformanceSample({ ...sample, durationMs: "123" }), null)
    assert.equal(sanitizeWorkspacePerformanceSample({ ...sample, hiddenDurationMs: 101 }), null)
})
