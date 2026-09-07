import assert from "node:assert/strict"
import test from "node:test"
import { observeChatViewportMotion, requestChatViewportMotion } from "../lib/chat-viewport-motion.ts"

function fixture(inFrame = false) {
    const host = new EventTarget()
    const reduced = Object.assign(new EventTarget(), { matches: false })
    const mobile = Object.assign(new EventTarget(), { matches: true })
    let nextId = 0
    const timers = new Map<number, () => void>()
    const view = Object.assign(host, {
        parent: inFrame ? new EventTarget() : host,
        matchMedia: (query: string) => query.includes("reduced") ? reduced : mobile,
        setTimeout: (callback: () => void) => { timers.set(++nextId, callback); return nextId },
        clearTimeout: (id: number) => timers.delete(id),
    })
    const doc = Object.assign(new EventTarget(), { defaultView: view, visibilityState: "visible" })
    let applied = 800, offset = 0, visible = true, commits = 0
    const writes: number[] = []
    const animations: { from: number; to: number; duration: number; playState: string; onfinish: (() => void) | null; cancel: () => void }[] = []
    const clip = Object.assign(new EventTarget(), {
        ownerDocument: doc, dataset: {} as Record<string, string>,
        getBoundingClientRect: () => ({ height: (inFrame || visible) ? applied - 100 : 0 }),
    })
    Object.defineProperty(clip, "clientHeight", { get: () => applied - 100 })
    const layer = {
        style: { height: "", willChange: "" },
        getBoundingClientRect: () => ({ bottom: 100 + (parseFloat(layer.style.height) || applied - 100) + offset }),
        querySelector: () => ({ dispatchEvent: (event: Event) => { if (event.type === "conversation-layout-commit") commits++ } }),
        animate: (frames: { transform: string }[], options: { duration: number }) => {
            const parse = (transform: string) => Number(transform.match(/, ([-\d.]+)px/)![1])
            const anim = { from: parse(frames[0].transform), to: parse(frames[1].transform), duration: options.duration, playState: "running", onfinish: null as (() => void) | null, cancel: () => { offset = 0; anim.playState = "idle" } }
            animations.push(anim)
            offset = anim.from
            return anim
        },
    }
    const frame = { getBoundingClientRect: () => ({ height: visible ? applied : 0 }) }
    if (inFrame) {
        Object.assign(view, { frameElement: frame })
        Object.assign(view.parent, { matchMedia: view.matchMedia })
    }
    const scope = { ownerDocument: { defaultView: view.parent }, contains: (node: unknown) => node === (inFrame ? frame : clip) }
    const cleanup = observeChatViewportMotion(clip as unknown as HTMLElement, layer as unknown as HTMLElement)
    const move = (bottom: number, duration = 300) => requestChatViewportMotion(scope as unknown as HTMLElement, applied, bottom, duration, (value) => { applied = value; writes.push(value) })
    const advance = (progress: number) => { const a = animations.at(-1)!; offset = a.from + (a.to - a.from) * progress; if (progress === 1) { a.playState = "finished"; a.onfinish?.() } }
    const touch = (type: string) => {
        const event = new Event(type)
        Object.defineProperty(event, "target", { value: { closest: () => true } })
        Object.defineProperty(event, "touches", { value: type === "touchstart" ? [{}] : [] })
        clip.dispatchEvent(event)
    }
    return { move, advance, touch, cleanup, animations, writes, layer, clip, doc, reduced, mobile, applied: () => applied, commits: () => commits, hide: () => { visible = false }, bottom: () => layer.getBoundingClientRect().bottom, settle: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()) } }
}

test("keyboard opening moves one layer without resizing the host between endpoints", () => {
    const f = fixture()
    try {
        f.move(500)
        assert.equal(f.applied(), 800)
        assert.equal(f.bottom(), 800)
        f.advance(0.5)
        assert.equal(f.bottom(), 650)
        assert.deepEqual(f.writes, [800])
        f.advance(1)
        assert.equal(f.applied(), 500)
        assert.equal(f.bottom(), 500)
        assert.equal(f.layer.style.height, "")
        assert.equal(f.layer.style.willChange, "")
        assert.equal(f.clip.dataset.chatViewportMoving, undefined)
        assert.equal(f.commits(), 2)
        assert.equal(f.animations[0].duration, 300)
    } finally { f.cleanup() }
})

test("closing expands once and begins at the same visible composer position", () => {
    const f = fixture()
    try {
        f.move(500, 0)
        f.move(800)
        assert.equal(f.applied(), 800)
        assert.equal(f.bottom(), 500)
        f.advance(1)
        assert.equal(f.bottom(), 800)
    } finally { f.cleanup() }
})

test("rapid reversals and revised keyboard heights start from the interrupted position", () => {
    const f = fixture()
    try {
        f.move(500); f.advance(0.5)
        f.move(800)
        assert.equal(f.bottom(), 650)
        f.advance(0.5)
        assert.equal(f.bottom(), 725)
        f.move(450)
        assert.equal(f.bottom(), 725)
        f.advance(1)
        assert.equal(f.bottom(), 450)
        assert.equal(f.applied(), 450)
    } finally { f.cleanup() }
})

test("reduced motion, desktop, and continuous viewport events commit immediately", () => {
    for (const option of ["reduced", "desktop", "continuous"]) {
        const f = fixture()
        try {
            f.reduced.matches = option === "reduced"
            f.mobile.matches = option !== "desktop"
            f.move(500, option === "continuous" ? 0 : 300)
            assert.equal(f.applied(), 500)
            assert.equal(f.bottom(), 500)
            assert.equal(f.animations.length, 0)
        } finally { f.cleanup() }
    }
})

test("a scroll gesture defers final scroller resizing until momentum settles", () => {
    const f = fixture()
    try {
        f.move(500); f.touch("touchstart"); f.advance(1)
        assert.equal(f.applied(), 800)
        assert.equal(f.bottom(), 500)
        f.touch("touchend"); f.settle()
        assert.equal(f.applied(), 500)
        assert.equal(f.bottom(), 500)
    } finally { f.cleanup() }
})

test("hidden conversations do not claim another chat's motion and unmount releases a pending layout", () => {
    const f = fixture()
    f.hide(); f.move(500)
    assert.equal(f.animations.length, 0)
    assert.equal(f.applied(), 500)
    f.cleanup()
    const g = fixture()
    g.move(500); g.advance(0.5); g.cleanup()
    assert.equal(g.applied(), 500)
    assert.equal(g.layer.style.height, "")
    assert.equal(g.layer.style.willChange, "")
})

test("a late finish callback cannot complete a newer animation", () => {
    const f = fixture()
    try {
        f.move(500)
        const oldFinish = f.animations[0].onfinish!
        f.advance(0.5); f.move(800); oldFinish()
        assert.equal(f.bottom(), 650)
        assert.equal(f.animations[1].playState, "running")
    } finally { f.cleanup() }
})


test("a hidden resident iframe cannot animate or finish a request for the active tab", () => {
    const f = fixture(true)
    try {
        f.move(500); f.advance(0.5)
        f.hide()
        f.move(800)
        assert.equal(f.animations.length, 1)
        assert.equal(f.applied(), 800)
        assert.equal(f.layer.style.willChange, "")
        f.animations[0].onfinish?.()
        assert.equal(f.applied(), 800)
    } finally { f.cleanup() }
})
