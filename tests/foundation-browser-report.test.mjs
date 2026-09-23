import assert from "node:assert/strict"
import test from "node:test"
import { assertFixtureReport } from "../scripts/browser/report.mjs"

test("browser gate rejects skipped, misreported and missing paint checks", () => {
    const report = { total: 2, passed: 2, cases: [{ passed: true }, { passed: true }] }
    assert.doesNotThrow(() => assertFixtureReport(report, 2))
    assert.throws(() => assertFixtureReport({ total: 1, passed: 1, cases: [{ passed: true }] }, 2))
    assert.throws(() => assertFixtureReport({ ...report, cases: [{ passed: true }] }, 2))
    assert.throws(() => assertFixtureReport({ ...report, cases: [{ passed: true }, { passed: false }] }, 2))
    assert.throws(() => assertFixtureReport({ ...report, missingPaintSamples: 1 }, 2))
    assert.throws(() => assertFixtureReport({ ...report, missing: ["suspended tab"] }, 2))
})
