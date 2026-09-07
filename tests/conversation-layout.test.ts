import assert from "node:assert/strict"
import test from "node:test"
import { observeConversationLayout } from "../components/communications/message-pane-observer.ts"

function fixture(following = true) {
    let resize!: () => void
    const observed: unknown[] = []
    const originalObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
        constructor(callback: () => void) { resize = callback }
        observe(element: unknown) { observed.push(element) }
        disconnect() {}
    } as unknown as typeof ResizeObserver
    const listeners = new Map<string, (event?: unknown) => void>()
    const timers = new Map<number, { at: number; callback: () => void }>()
    const frames = new Map<number, () => void>()
    let now = 0, sequence = 0, captures = 0
    const writes: number[] = []
    const view = {
        setTimeout(callback: () => void, delay: number) { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id },
        clearTimeout(id: number) { timers.delete(id) },
        requestAnimationFrame(callback: () => void) { const id = ++sequence; frames.set(id, callback); return id },
        cancelAnimationFrame(id: number) { frames.delete(id) },
    }
    function flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()) }
    function tick(ms: number) { now += ms; for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback() } flush() }
    function emit(name: string, event: unknown = {}) { listeners.get(name)?.(event) }
    const follow = { current: following }
    const content = {}
    const state = { clientHeight: 300, scrollHeight: 1000, scrollTop: following ? 0 : 200, scrollLeft: 0 }
    const positions = Array.from({ length: 10 }, (_, i) => i * 100)
    const rows = positions.map((_, i) => ({ isConnected: true, getBoundingClientRect: () => ({ top: positions[i] - state.scrollTop, bottom: positions[i] + 100 - state.scrollTop }) }))
    const pane = {
        ...state,
        dataset: {},
        ownerDocument: { defaultView: view },
        firstElementChild: content,
        get clientHeight() { return state.clientHeight }, get scrollHeight() { return state.scrollHeight },
        get scrollTop() { return state.scrollTop }, get scrollLeft() { return state.scrollLeft },
        contains: (element: unknown) => rows.includes(element as typeof rows[number]),
        getBoundingClientRect: () => ({ top: 0 }),
        querySelectorAll: () => { captures++; return rows },
        addEventListener: (name: string, callback: (event?: unknown) => void) => listeners.set(name, callback),
        removeEventListener: (name: string) => listeners.delete(name),
        scrollTo: ({ top }: { top: number }) => { writes.push(top); state.scrollTop = top },
    }
    const statuses: boolean[] = []
    const dispose = observeConversationLayout(pane as unknown as HTMLDivElement, follow, (latest) => statuses.push(latest))
    writes.length = 0 // Only track corrections after initial positioning.
    return { emit, tick, flush, writes, captures: () => captures, pending: () => frames.size + timers.size, state, positions, follow, resize: () => resize(), scroll: () => listeners.get("scroll")?.(), observed, content, statuses, cleanup: () => { dispose(); globalThis.ResizeObserver = originalObserver } }
}

test("opening and subsequent content growth stay at latest even when the pane does not resize", () => {
    const f = fixture()
    try {
        assert.equal(f.state.scrollTop, 700)
        assert.ok(f.observed.includes(f.content))
        f.state.scrollHeight += 450
        f.resize()
        assert.equal(f.state.scrollTop, 1150)
        assert.equal(f.statuses.at(-1), true)
    } finally { f.cleanup() }
})

test("loading or removing content above a reader preserves the visible message", () => {
    const f = fixture(false)
    try {
        for (let i = 2; i < f.positions.length; i++) f.positions[i] += 250
        f.state.scrollHeight += 250
        f.resize()
        assert.equal(f.state.scrollTop, 450)
        f.state.scrollHeight += 100 // growth below the anchor must not move it
        f.resize()
        assert.equal(f.state.scrollTop, 450)
        for (let i = 2; i < f.positions.length; i++) f.positions[i] -= 250
        f.state.scrollHeight -= 250
        f.resize()
        assert.equal(f.state.scrollTop, 200)
    } finally { f.cleanup() }
})

test("hidden tabs do not overwrite the history anchor and keyboard resizing preserves the visible bottom", () => {
    const f = fixture(false)
    try {
        f.state.clientHeight = 0
        f.state.scrollTop = 0 // display:none can clamp the browser scroll position
        f.resize()
        f.state.clientHeight = 300
        f.resize()
        assert.equal(f.state.scrollTop, 200)
        f.state.clientHeight = 200
        f.resize()
        assert.equal(f.state.scrollTop, 300)
        f.state.clientHeight = 300
        f.resize()
        assert.equal(f.state.scrollTop, 200)
    } finally { f.cleanup() }
})

test("user scrolling releases latest before subsequent media resize", async () => {
    const f = fixture()
    try {
        f.state.scrollTop = 200
        f.scroll()
        f.follow.current = false // React's event handler runs after the native listener.
        f.flush()
        f.state.scrollHeight += 400
        f.resize()
        assert.equal(f.state.scrollTop, 200)
        assert.equal(f.statuses.at(-1), false)
    } finally { f.cleanup() }
})

test("fixed-size preview loads and redundant resize notifications never undo an unreported scroll", () => {
    const f = fixture(false)
    try {
        f.state.scrollTop = 180
        f.emit("load")
        f.resize()
        assert.equal(f.state.scrollTop, 180)
        assert.deepEqual(f.writes, [])
    } finally { f.cleanup() }
})

test("real layout shifts preserve both the anchor and native movement ahead of scroll events", () => {
    const f = fixture(false)
    try {
        f.state.scrollTop = 180
        for (let i = 2; i < f.positions.length; i++) f.positions[i] += 250
        f.state.scrollHeight += 250
        f.resize()
        assert.equal(f.state.scrollTop, 430) // 180 user position + 250 layout delta
    } finally { f.cleanup() }
})

test("native touch scrolling survives pointer cancellation before any pointermove", () => {
    const f = fixture()
    try {
        f.emit("touchstart")
        f.emit("pointercancel")
        f.tick(1000) // The finger can pause without losing ownership.
        f.state.scrollTop = 620
        f.scroll()
        assert.equal(f.follow.current, false)
        f.state.scrollHeight += 250
        f.resize()
        f.emit("load")
        assert.equal(f.state.scrollTop, 620)
        f.emit("touchend", { touches: [] })
        f.tick(250)
        f.resize()
        assert.equal(f.state.scrollTop, 620)
        assert.deepEqual(f.writes, [])
    } finally { f.cleanup() }
})

test("momentum owns scrolling until it settles and never replays deferred layout corrections", () => {
    const f = fixture(false)
    try {
        f.emit("touchstart")
        f.emit("touchend", { touches: [] })
        const captures = f.captures()
        for (const top of [180, 160, 140, 120]) {
            f.tick(100)
            f.state.scrollTop = top
            f.scroll()
            f.flush()
            f.state.clientHeight -= 5 // e.g. viewport chrome moving during the gesture
            f.resize()
            assert.equal(f.state.scrollTop, top)
        }
        assert.equal(f.captures(), captures)
        f.tick(250)
        assert.equal(f.state.scrollTop, 120)
        assert.deepEqual(f.writes, [])
        assert.ok(f.captures() > captures)
        for (let i = 1; i < f.positions.length; i++) f.positions[i] += 50
        f.state.scrollHeight += 50
        f.resize()
        assert.equal(f.state.scrollTop, 170) // Normal anchoring resumes after settling.
    } finally { f.cleanup() }
})

test("scrolling back to latest resumes following subsequent messages", () => {
    const f = fixture(false)
    try {
        f.emit("touchstart")
        f.state.scrollTop = 700
        f.scroll()
        f.emit("touchend", { touches: [] })
        f.tick(250)
        assert.equal(f.follow.current, true)
        f.state.scrollHeight += 100
        f.resize()
        assert.equal(f.state.scrollTop, 800)
    } finally { f.cleanup() }
})

test("a stationary tap only postpones following new content until release", () => {
    const f = fixture()
    try {
        f.emit("touchstart")
        f.state.scrollHeight += 100
        f.resize()
        assert.equal(f.state.scrollTop, 700)
        f.tick(1000)
        assert.equal(f.state.scrollTop, 700)
        f.emit("touchend", { touches: [] })
        f.tick(250)
        assert.equal(f.state.scrollTop, 800)
    } finally { f.cleanup() }
})

test("wheel scrolling also yields to user movement and reports positions only on threshold changes", () => {
    const f = fixture()
    try {
        f.emit("wheel", { deltaY: -20 })
        assert.equal(f.follow.current, false)
        for (const top of [600, 580, 560]) {
            f.state.scrollTop = top
            f.scroll()
            f.flush()
        }
        assert.deepEqual(f.statuses, [true, false])
        f.tick(250)
        f.emit("load")
        assert.equal(f.state.scrollTop, 560)
        assert.deepEqual(f.writes, [])
    } finally { f.cleanup() }
})

test("disposing a scrolling conversation cancels pending frames and settling work", () => {
    const f = fixture(false)
    f.emit("touchstart")
    f.state.scrollTop = 180
    f.scroll()
    f.emit("touchcancel", { touches: [] })
    assert.ok(f.pending() > 0)
    f.cleanup()
    assert.equal(f.pending(), 0)
    f.tick(1000)
    assert.equal(f.state.scrollTop, 180)
})
