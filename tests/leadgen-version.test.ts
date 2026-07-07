import assert from "node:assert/strict"
import test from "node:test"

import {
    LEADGEN_POLLING_SYSTEM_VERSION,
    LEADGEN_POLLING_SYSTEM_VERSION_HISTORY,
    LEADGEN_POLLING_SYSTEM_VERSION_LABEL,
} from "../lib/leadgen/version.ts"

test("leadgen polling system version is bumped for the v5.4.11 source pass", () => {
    assert.equal(LEADGEN_POLLING_SYSTEM_VERSION, "5.4.11")
    assert.equal(LEADGEN_POLLING_SYSTEM_VERSION_LABEL, "v5.4.11")
    assert.equal(LEADGEN_POLLING_SYSTEM_VERSION_HISTORY.at(-1)?.version, "5.4.11")
    assert.equal(LEADGEN_POLLING_SYSTEM_VERSION_HISTORY.some((entry) => entry.version === "5.1.1"), true)
})
