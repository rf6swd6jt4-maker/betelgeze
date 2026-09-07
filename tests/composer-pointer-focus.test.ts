import assert from "node:assert/strict"
import test from "node:test"
import { createComposerPointerFocus } from "../components/communications/composer-pointer-focus.ts"

const pointer = (overrides: Partial<PointerEvent> = {}) => ({ pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX: 20, clientY: 20, ...overrides }) as PointerEvent

test("touch focuses synchronously on release, never while the finger is still down", () => {
    const calls: string[] = []
    const handlers = createComposerPointerFocus(() => calls.push("focus"))
    handlers.pointerdown(pointer()); assert.deepEqual(calls, [])
    handlers.pointerup(pointer()); assert.deepEqual(calls, ["focus"])
    handlers.pointerup(pointer()); assert.equal(calls.length, 1)
    // The very next completed tap is accepted without any cooldown or timer.
    handlers.pointerdown(pointer()); handlers.pointerup(pointer())
    assert.equal(calls.length, 2)
})

test("mouse focuses on contact while pen uses release", () => {
    let count = 0
    const handlers = createComposerPointerFocus(() => count++)
    handlers.pointerdown(pointer({ pointerType: "mouse" })); assert.equal(count, 1)
    handlers.pointerup(pointer({ pointerType: "mouse" })); assert.equal(count, 1)
    handlers.pointerdown(pointer({ pointerType: "pen" })); assert.equal(count, 1)
    handlers.pointerup(pointer({ pointerType: "pen" })); assert.equal(count, 2)
})

test("scrolls, cancelled touches, secondary clicks, and multiple fingers never force focus", () => {
    let count = 0
    const handlers = createComposerPointerFocus(() => count++)
    handlers.pointerdown(pointer()); handlers.pointermove(pointer({ clientY: 50 })); handlers.pointerup(pointer())
    handlers.pointerdown(pointer()); handlers.pointercancel(); handlers.pointerup(pointer())
    handlers.pointerdown(pointer({ button: 2 })); handlers.pointerup(pointer())
    handlers.pointerdown(pointer()); handlers.pointerdown(pointer({ pointerId: 2, isPrimary: false })); handlers.pointerup(pointer())
    handlers.pointerdown(pointer()); handlers.pointerup(pointer({ clientY: 60 }))
    assert.equal(count, 0)
})
