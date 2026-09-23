import assert from "node:assert/strict"
import test from "node:test"
import { mobileWorkspaceBounds } from "../lib/mobile-workspace-viewport.ts"

function view(height: number, offsetTop = 0, scale = 1) {
    return { innerHeight: 850, visualViewport: { height, offsetTop, scale } as VisualViewport }
}

test("panning changes the mobile origin without inflating the usable height", () => {
    assert.deepEqual(mobileWorkspaceBounds(view(490, 220)), { top: 220, height: 490 })
    assert.deepEqual(mobileWorkspaceBounds(view(490, 0)), { top: 0, height: 490 })
    assert.deepEqual(mobileWorkspaceBounds(view(850, 0)), { top: 0, height: 850 })
})

test("invalid and zoomed samples cannot invent a keyboard-close geometry", () => {
    for (const sample of [view(0), view(NaN), view(490, -1), view(490, Infinity), view(490, 0, 1.5)]) {
        assert.equal(mobileWorkspaceBounds(sample), null)
    }
    assert.deepEqual(mobileWorkspaceBounds({ innerHeight: 700, visualViewport: null }), { top: 0, height: 700 })
})
