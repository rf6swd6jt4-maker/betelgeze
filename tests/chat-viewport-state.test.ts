import assert from "node:assert/strict"
import test from "node:test"
import { readChatViewportBottom, recordChatViewportDiagnostic } from "../lib/chat-viewport-state.ts"

function fixture() {
    return {
        innerHeight: 800,
        document: { documentElement: { clientHeight: 800, scrollTop: 0 } },
        visualViewport: { height: 500, offsetTop: 0, scale: 1 },
    }
}

test("viewport measurements include the visible offset without moving the shell origin", () => {
    const view = fixture()
    assert.equal(readChatViewportBottom(view as unknown as Window), 500)
    view.visualViewport.offsetTop = 100
    assert.equal(readChatViewportBottom(view as unknown as Window), 600)
})

test("zero, non-finite, overscrolled, and zoomed geometry is rejected", () => {
    for (const sample of [
        { height: 0 }, { height: -1 }, { height: NaN }, { height: Infinity },
        { offsetTop: -10 }, { offsetTop: NaN }, { offsetTop: 500 },
        { scale: 2 }, { scale: NaN },
    ]) {
        const view = fixture()
        Object.assign(view.visualViewport, sample)
        assert.ok(Number.isNaN(readChatViewportBottom(view as unknown as Window)))
    }
})

test("diagnostics remain bounded and contain only geometry and lifecycle state", () => {
    const view = fixture() as unknown as Window & { __betelgezeChatViewportDiagnostics: unknown[] }
    for (let i = 0; i < 100; i++) {
        recordChatViewportDiagnostic(view, "workspace", null, { event: "focus", measured: 500, requested: 500, focused: true })
    }
    assert.equal(view.__betelgezeChatViewportDiagnostics.length, 64)
    assert.deepEqual(Object.keys(view.__betelgezeChatViewportDiagnostics[0] as object).sort(), [
        "at", "event", "focused", "height", "layoutHeight", "measured", "offsetTop", "panelHeight", "panelTop", "requested", "scale", "scrollTop", "surface",
    ].sort())
})
