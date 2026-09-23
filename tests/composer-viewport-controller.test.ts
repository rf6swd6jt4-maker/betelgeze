import assert from "node:assert/strict"
import test from "node:test"
import { createComposerViewportController } from "../lib/composer-viewport-controller.ts"

function fixture(mobile = true, initial = 800) {
    let bottom = initial, layout = 800, applied = 800, id = 0
    const writes: { bottom: number; animate: boolean }[] = []
    const timers = new Map<number, () => void>()
    const callbacks: (() => void)[] = []
    const controller = createComposerViewportController({
        readBottom: () => bottom,
        readLayoutBottom: () => layout,
        readAppliedBottom: () => applied,
        writeBottom: (value, animate) => { writes.push({ bottom: value, animate }); applied = value },
        animateKeyboard: () => mobile,
        schedule: (callback) => { callbacks.push(callback); timers.set(++id, callback); return id },
        cancel: (timer) => { timers.delete(timer) },
    })
    return {
        controller, writes, timers, callbacks,
        target: () => writes.at(-1),
        sample: (value: number) => { bottom = value; controller.update() },
        read: (value: number) => { bottom = value },
        setApplied: (value: number) => { applied = value },
        resizeLayout: (value: number) => { layout = value },
        settle: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()) },
        open: () => { controller.focus(); bottom = 500; controller.update() },
    }
}

test("focus and blur use the measured edge without predicting a keyboard endpoint", () => {
    const f = fixture()
    assert.deepEqual(f.target(), { bottom: 800, animate: false })
    f.controller.focus()
    assert.equal(f.writes.length, 1)
    f.sample(500)
    assert.deepEqual(f.target(), { bottom: 500, animate: true })
    const count = f.writes.length
    f.controller.blur()
    assert.equal(f.writes.length, count)
    f.sample(620)
    assert.deepEqual(f.target(), { bottom: 620, animate: true })
    f.sample(800)
    assert.deepEqual(f.target(), { bottom: 800, animate: false })
})

test("a changed measurement already present at blur is applied immediately", () => {
    const f = fixture()
    f.open()
    f.read(620)
    f.controller.blur()
    assert.deepEqual(f.target(), { bottom: 620, animate: true })
})

test("the first substantial jump can animate, then shorter and taller keyboards follow immediately", () => {
    const f = fixture()
    f.open()
    assert.deepEqual(f.target(), { bottom: 500, animate: true })
    f.sample(450)
    assert.deepEqual(f.target(), { bottom: 450, animate: false })
    f.sample(520) // The old opening-minimum lock discarded this real shorter keyboard.
    assert.deepEqual(f.target(), { bottom: 520, animate: false })
    f.sample(560)
    assert.deepEqual(f.target(), { bottom: 560, animate: false })
    f.settle()
    assert.equal(f.target()?.bottom, 560)
})

test("small leading movements establish a continuous opening and closing sequence", () => {
    const f = fixture()
    f.controller.focus()
    f.sample(798)
    f.sample(650)
    f.sample(500)
    assert.deepEqual(f.writes.slice(1), [
        { bottom: 798, animate: false },
        { bottom: 650, animate: false },
        { bottom: 500, animate: false },
    ])
    f.controller.blur()
    f.sample(502)
    f.sample(650)
    f.sample(800)
    assert.deepEqual(f.writes.slice(-3), [
        { bottom: 502, animate: false },
        { bottom: 650, animate: false },
        { bottom: 800, animate: false },
    ])
})

test("rapid reopen follows its current edge and cancels an old close confirmation", () => {
    const f = fixture()
    f.open()
    f.controller.blur()
    const staleClose = f.callbacks.at(-1)!
    f.read(620)
    f.controller.focus()
    assert.deepEqual(f.target(), { bottom: 620, animate: false })
    f.sample(500)
    assert.deepEqual(f.target(), { bottom: 500, animate: false })
    const count = f.writes.length
    f.read(300)
    staleClose()
    assert.equal(f.writes.length, count)
    assert.equal(f.timers.size, 1)
})

test("a fresh unchanged measurement repairs layout after an animation was retired", () => {
    const f = fixture()
    f.open()
    f.controller.suspend()
    f.setApplied(800) // The transient motion was retired before its target reached layout.
    const count = f.writes.length
    f.controller.resume()
    assert.equal(f.writes.length, count + 1)
    assert.deepEqual(f.target(), { bottom: 500, animate: false })
    f.controller.update()
    assert.equal(f.writes.length, count + 1) // Matching applied geometry needs no repeat.
})

test("a live unchanged viewport event can repair a retired motion directly", () => {
    const f = fixture()
    f.open()
    f.setApplied(800)
    f.controller.update()
    assert.deepEqual(f.target(), { bottom: 500, animate: false })
    const count = f.writes.length
    f.controller.update()
    assert.equal(f.writes.length, count)
})

test("focus repairs a retired animation even when the viewport edge has not changed", () => {
    const f = fixture()
    f.open()
    f.controller.blur()
    f.setApplied(800)
    f.controller.focus()
    assert.deepEqual(f.target(), { bottom: 500, animate: false })
})

test("repeated taps have no cooldown and keep one pending confirmation", () => {
    const f = fixture()
    for (let i = 0; i < 40; i++) {
        f.controller.focus()
        f.sample(500)
        f.controller.blur()
        f.sample(650)
        f.sample(800)
        assert.equal(f.target()?.bottom, 800)
        assert.equal(f.timers.size, 1)
    }
})

test("keyboard dismissal and reopening without blur use each measured edge", () => {
    const f = fixture()
    f.open()
    f.sample(800)
    assert.deepEqual(f.target(), { bottom: 800, animate: false })
    f.sample(550)
    assert.deepEqual(f.target(), { bottom: 550, animate: false })
})

test("late metrics get one bounded confirmation and use the latest edge", () => {
    const f = fixture()
    f.open()
    f.read(530) // The last resize event preceded its metric update.
    f.settle()
    assert.equal(f.target()?.bottom, 500)
    assert.equal(f.timers.size, 1)
    f.read(540)
    f.settle()
    assert.deepEqual(f.target(), { bottom: 540, animate: false })
    assert.equal(f.timers.size, 0)
    f.settle()
    assert.equal(f.timers.size, 0)
})

test("layout resize changes the resting reference but never supplies a geometry write", () => {
    const f = fixture()
    f.open()
    f.resizeLayout(600)
    f.sample(320)
    assert.deepEqual(f.target(), { bottom: 320, animate: false })
    const count = f.writes.length
    f.controller.blur()
    assert.equal(f.writes.length, count)
    f.sample(450)
    assert.equal(f.target()?.bottom, 450)
    f.sample(600)
    assert.equal(f.target()?.bottom, 600)
})

test("invalid and zoom-rejected samples retain the last valid edge", () => {
    const f = fixture()
    f.open()
    for (const invalid of [0, -100, NaN, Infinity]) {
        const count = f.writes.length
        f.sample(invalid)
        assert.equal(f.writes.length, count)
        assert.equal(f.target()?.bottom, 500)
    }
    f.read(550)
    f.settle()
    assert.equal(f.target()?.bottom, 500)
    f.settle()
    assert.deepEqual(f.target(), { bottom: 550, animate: false })
})

test("an invalid initial measurement writes only after a valid edge arrives", () => {
    const f = fixture(true, NaN)
    assert.equal(f.writes.length, 0)
    f.controller.focus()
    assert.equal(f.writes.length, 0)
    f.sample(500)
    assert.deepEqual(f.target(), { bottom: 500, animate: false })
    f.controller.blur()
    assert.equal(f.target()?.bottom, 500)
})

test("suspension and resume preserve geometry until a current valid reading is available", () => {
    const f = fixture()
    f.open()
    const stale = f.callbacks.at(-1)!
    const count = f.writes.length
    f.controller.suspend()
    assert.equal(f.writes.length, count)
    assert.equal(f.timers.size, 0)
    f.read(NaN)
    f.controller.resume()
    assert.equal(f.writes.length, count)
    f.read(620)
    f.controller.update()
    assert.deepEqual(f.target(), { bottom: 620, animate: false })
    f.read(300)
    stale()
    assert.equal(f.target()?.bottom, 620)
})

test("resume immediately applies a valid changed edge", () => {
    const f = fixture()
    f.open()
    f.controller.suspend()
    f.read(620)
    f.controller.resume()
    assert.deepEqual(f.target(), { bottom: 620, animate: false })
})

test("queued reconciliation cannot override new focus, suspension or disposal", () => {
    for (const action of ["reopen", "suspend", "dispose"]) {
        const f = fixture()
        f.open()
        const stale = f.callbacks.at(-1)!
        if (action === "reopen") { f.controller.blur(); f.read(620); f.controller.focus() }
        else if (action === "suspend") f.controller.suspend()
        else f.controller.dispose()
        const count = f.writes.length
        f.read(300)
        stale()
        assert.equal(f.writes.length, count)
    }
})

test("dispose cancels work and never restores an invented full-height edge", () => {
    const f = fixture()
    f.open()
    const stale = f.callbacks.at(-1)!
    f.controller.dispose()
    const count = f.writes.length
    assert.equal(f.timers.size, 0)
    stale()
    f.controller.focus()
    f.controller.blur()
    f.controller.resume()
    f.sample(800)
    assert.equal(f.writes.length, count)
    assert.equal(f.target()?.bottom, 500)
})

test("desktop follows measurements without keyboard animation", () => {
    const f = fixture(false)
    f.controller.focus()
    f.sample(400)
    assert.deepEqual(f.target(), { bottom: 400, animate: false })
    f.controller.blur()
    f.sample(700)
    assert.deepEqual(f.target(), { bottom: 700, animate: false })
})
