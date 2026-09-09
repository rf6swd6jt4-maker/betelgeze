import assert from "node:assert/strict"
import test from "node:test"
import { containComposerTouch } from "../components/communications/composer-touch.ts"

function setup(draft?: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
    const listeners = new Map<string, (event: unknown) => void>()
    const text = {}
    const selection = { isCollapsed: true, anchorNode: text, focusNode: text }
    const editor = { matches: () => true, tagName: "DIV", contains: (node: unknown) => node === text || node === editor, getBoundingClientRect: () => ({ left: 100, right: 300, top: 100, bottom: 144 }) }
    const doc = { activeElement: editor as typeof editor | null, getSelection: () => selection }
    const surface = {
        ownerDocument: doc,
        contains: (element: unknown) => element === editor,
        addEventListener(name: string, fn: (event: unknown) => void, options?: { passive: boolean }) {
            if (name === "touchmove") assert.equal(options?.passive, false)
            listeners.set(name, fn)
        },
        removeEventListener(name: string) { listeners.delete(name) },
    }
    const cleanup = containComposerTouch(surface as unknown as HTMLElement)
    const emit = (name: string, y: number, count = 1, area: "editor" | "button" | "padding" | "handle" | "tray" = "editor") => {
        let prevented = false
        const target = { closest: (selector: string) => {
            if (selector.includes("button")) return area === "button" ? target : null
            if (selector.includes("data-chat-composer")) return area === "editor" ? editor : null
            return area === "editor" || area === "tray" ? draft ?? null : null
        } }
        listeners.get(name)?.({ touches: Array.from({ length: count }, () => ({ clientX: area === "padding" ? 20 : 200, clientY: y })), target, cancelable: true, preventDefault: () => { prevented = true } })
        return prevented
    }
    return { emit, cleanup, listeners, selection, doc }
}

test("empty composer and footer drags cannot pan the page; taps stay native", () => {
    for (const draft of [undefined, { scrollHeight: 44, clientHeight: 44, scrollTop: 0 }]) {
        const { emit, cleanup, listeners } = setup(draft)
        assert.equal(emit("touchstart", 100), false)
        assert.equal(emit("touchmove", 70), true)
        assert.equal(emit("touchmove", 110), true)
        cleanup()
        assert.equal(listeners.size, 0)
    }
})

test("long drafts scroll internally but block outward drags at both boundaries", () => {
    const draft = { scrollHeight: 240, clientHeight: 100, scrollTop: 50 }
    const { emit } = setup(draft)
    emit("touchstart", 100)
    assert.equal(emit("touchmove", 90), false)
    draft.scrollTop = 140
    assert.equal(emit("touchmove", 80), true)
    assert.equal(emit("touchmove", 90), false)
    draft.scrollTop = 0
    assert.equal(emit("touchmove", 100), true)
    assert.equal(emit("touchmove", 90), false)
})

test("multi-touch and cancelled gestures are left alone", () => {
    const { emit } = setup()
    emit("touchstart", 100, 2)
    assert.equal(emit("touchmove", 80, 2), false)
    emit("touchstart", 100)
    emit("touchcancel", 100, 0)
    assert.equal(emit("touchmove", 80), false)
})

test("selection handles remain draggable in a one-line composer, even across a collapsed range", () => {
    const { emit, selection } = setup({ scrollHeight: 44, clientHeight: 44, scrollTop: 0 })
    selection.isCollapsed = false
    emit("touchstart", 100)
    assert.equal(emit("touchmove", 70), false)
    selection.isCollapsed = true
    assert.equal(emit("touchmove", 110), false)
    emit("touchend", 110, 0)
    emit("touchstart", 100)
    assert.equal(emit("touchmove", 70), true)
})

test("selection established by a long press after touchstart keeps native movement", () => {
    const { emit, selection } = setup()
    emit("touchstart", 100)
    selection.isCollapsed = false
    assert.equal(emit("touchmove", 100), false)
    assert.equal(emit("touchmove", 110), false)
})

test("selection elsewhere and unfocused drafts do not disable footer containment", () => {
    const { emit, selection, doc } = setup()
    selection.isCollapsed = false
    selection.anchorNode = {}
    emit("touchstart", 100)
    assert.equal(emit("touchmove", 70), true)
    doc.activeElement = null
    emit("touchstart", 100)
    assert.equal(emit("touchmove", 70), true)
})

test("selection at either long-draft boundary is not mistaken for outward scrolling", () => {
    for (const scrollTop of [0, 140]) {
        const { emit, selection } = setup({ scrollHeight: 240, clientHeight: 100, scrollTop })
        selection.isCollapsed = false
        emit("touchstart", 100)
        assert.equal(emit("touchmove", 70), false)
        assert.equal(emit("touchmove", 110), false)
    }
})

test("selected text does not release page panning on composer buttons or distant footer padding", () => {
    for (const area of ["button", "padding"] as const) {
        const { emit, selection } = setup()
        selection.isCollapsed = false
        emit("touchstart", 100, 1, area)
        assert.equal(emit("touchmove", 70, 1, area), true)
    }
})

test("a native handle retargeted just outside the editor keeps its complete gesture", () => {
    const { emit, selection } = setup()
    selection.isCollapsed = false
    emit("touchstart", 160, 1, "handle")
    assert.equal(emit("touchmove", 220, 1, "handle"), false)
    selection.isCollapsed = true
    assert.equal(emit("touchmove", 250, 1, "handle"), false)
})

test("selected text does not release boundary containment for a separate sticker tray", () => {
    const { emit, selection } = setup({ scrollHeight: 300, clientHeight: 100, scrollTop: 200 })
    selection.isCollapsed = false
    emit("touchstart", 100, 1, "tray")
    assert.equal(emit("touchmove", 70, 1, "tray"), true)
    assert.equal(emit("touchmove", 110, 1, "tray"), false)
})
