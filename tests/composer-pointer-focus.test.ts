import assert from "node:assert/strict"
import test from "node:test"
import { createComposerPointerFocus, retainNativeComposerFocus } from "../components/communications/composer-pointer-focus.ts"

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

test("native focus leaves touch, pen and mouse activation to the browser", () => {
    let count = 0
    const handlers = createComposerPointerFocus(() => count++, () => true)
    for (const pointerType of ["touch", "pen", "mouse"]) {
        const event = pointer({ pointerType, preventDefault: () => assert.fail("Native activation was cancelled"), stopPropagation: () => assert.fail("Native activation was intercepted") })
        handlers.pointerdown(event)
        handlers.pointerup(event)
    }
    assert.equal(count, 0)
})

test("changing into native scope abandons an earlier pending manual tap", () => {
    let native = false, count = 0
    const handlers = createComposerPointerFocus(() => count++, () => native)
    handlers.pointerdown(pointer())
    native = true
    handlers.pointerup(pointer())
    native = false
    handlers.pointerup(pointer())
    assert.equal(count, 0)
    handlers.pointerdown(pointer()); handlers.pointerup(pointer())
    assert.equal(count, 1)
})

function fakeEditor() {
    const node = new EventTarget()
    const ownerDocument: { activeElement: EventTarget | null } = { activeElement: node }
    const calls: FocusOptions[] = []
    const editor = Object.assign(node, {
        ownerDocument,
        focus(options: FocusOptions) { calls.push(options) },
    }) as unknown as HTMLElement
    return { editor, ownerDocument, calls }
}

test("native focus is reasserted synchronously during focusin without cancelling it", () => {
    const { editor, calls } = fakeEditor()
    const dispose = retainNativeComposerFocus(editor, () => true)
    const observed: number[] = []
    editor.addEventListener("focusin", () => observed.push(calls.length))
    const event = new Event("focusin", { cancelable: true })
    editor.dispatchEvent(event)
    assert.deepEqual(calls, [{ preventScroll: true }])
    assert.deepEqual(observed, [1], "Reassertion must happen in the same focus event, before later listeners")
    assert.equal(event.defaultPrevented, false)
    dispose()
})

test("click reasserts an already active editor even when no new focusin fires", () => {
    const { editor, calls } = fakeEditor()
    const dispose = retainNativeComposerFocus(editor, () => true)
    const event = new Event("click", { cancelable: true })
    editor.dispatchEvent(event)
    assert.deepEqual(calls, [{ preventScroll: true }])
    assert.equal(event.defaultPrevented, false)
    dispose()
})

test("native focus cannot steal focus and dynamically respects disabled scope", () => {
    const { editor, ownerDocument, calls } = fakeEditor()
    let enabled = false
    const dispose = retainNativeComposerFocus(editor, () => enabled)
    editor.dispatchEvent(new Event("focusin")); editor.dispatchEvent(new Event("click"))
    enabled = true
    ownerDocument.activeElement = new EventTarget()
    editor.dispatchEvent(new Event("focusin")); editor.dispatchEvent(new Event("click"))
    assert.deepEqual(calls, [])
    ownerDocument.activeElement = editor
    editor.dispatchEvent(new Event("click"))
    assert.deepEqual(calls, [{ preventScroll: true }])
    dispose()
})

test("nested focusin cannot recursively focus and disposal removes both listeners", () => {
    const { editor, calls } = fakeEditor()
    editor.focus = options => {
        calls.push(options ?? {})
        assert(calls.length <= 1, "Reentrant focus must not recurse")
        editor.dispatchEvent(new Event("focusin"))
    }
    const dispose = retainNativeComposerFocus(editor, () => true)
    editor.dispatchEvent(new Event("focusin"))
    assert.deepEqual(calls, [{ preventScroll: true }])
    dispose()
    editor.dispatchEvent(new Event("focusin")); editor.dispatchEvent(new Event("click"))
    assert.equal(calls.length, 1)
})
