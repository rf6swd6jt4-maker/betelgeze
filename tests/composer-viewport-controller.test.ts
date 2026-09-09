import assert from "node:assert/strict"
import test from "node:test"
import { createComposerViewportController } from "../lib/composer-viewport-controller.ts"

function fixture(mobile = true, initial = 800) {
    let bottom = initial, layout = 800, id = 0
    const writes: { bottom: number; animate: boolean }[] = []
    const timers = new Map<number, () => void>()
    const callbacks: (() => void)[] = []
    const controller = createComposerViewportController({
        readBottom: () => bottom,
        readLayoutBottom: () => layout,
        writeBottom: (bottom, animate) => writes.push({ bottom, animate }),
        animateKeyboard: () => mobile,
        schedule: (callback) => { callbacks.push(callback); timers.set(++id, callback); return id },
        cancel: (timer) => { timers.delete(timer) },
    })
    return { controller, writes, timers, callbacks, target: () => writes.at(-1), sample: (value: number) => { bottom = value; controller.update() }, read: (value: number) => { bottom = value }, resizeLayout: (value: number) => { layout = value }, settle: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()) }, open: () => { controller.focus(); bottom = 500; controller.update() } }
}

test("rapid reopen waits for fresh keyboard geometry instead of lifting into a cached empty gap", () => {
    const f = fixture()
    f.open(); f.controller.blur()
    f.read(800) // iOS has closed, but its resize event has not arrived yet.
    const count = f.writes.length
    f.controller.focus()
    assert.equal(f.writes.length, count)
    assert.equal(f.target()?.bottom, 800)
    f.sample(500)
    assert.deepEqual(f.target(), { bottom: 500, animate: true })
    assert.equal(f.timers.size, 1) // Only the new viewport confirmation remains.
})

test("reopening while the keyboard is still present uses the current edge immediately", () => {
    const f = fixture()
    f.open(); f.controller.blur()
    f.read(620) // Actual current edge, not the previous 500px endpoint.
    f.controller.focus()
    assert.deepEqual(f.target(), { bottom: 620, animate: true })
    f.sample(500)
    assert.equal(f.target()?.bottom, 500)
})

test("late closure samples and duplicate focus cannot reset a reopened keyboard", () => {
    const f = fixture()
    f.open(); f.controller.blur(); f.read(800); f.controller.focus(); f.sample(500)
    const count = f.writes.length
    f.controller.focus(); f.sample(800); f.controller.focus(); f.sample(500)
    assert.equal(f.writes.length, count)
    f.controller.blur()
    assert.equal(f.target()?.bottom, 800) // The resting baseline was not replaced by 500.
})

test("repeated open-close bursts always obey the last intent and cancel obsolete close work", () => {
    const f = fixture()
    for (let i = 0; i < 40; i++) {
        f.read(800); f.controller.focus(); f.sample(500)
        assert.equal(f.target()?.bottom, 500)
        f.controller.blur(); f.controller.blur()
        assert.equal(f.target()?.bottom, 800)
        f.sample(650) // A trailing viewport sample after blur must not reopen it.
        assert.equal(f.target()?.bottom, 800)
    }
    f.read(800); f.controller.focus(); f.sample(500)
    assert.equal(f.target()?.bottom, 500)
    assert.equal(f.timers.size, 1)
})

test("blurring before keyboard geometry arrives ignores the cancelled opening", () => {
    const f = fixture()
    f.controller.focus(); f.controller.blur()
    f.sample(500) // The cancelled native opening reports its shrink late.
    assert.equal(f.target()?.bottom, 800)
    f.read(800); f.controller.focus(); f.sample(500)
    assert.equal(f.target()?.bottom, 500)
    f.controller.blur()
    assert.equal(f.target()?.bottom, 800)
})

test("even an already queued close callback cannot change a newly focused composer", () => {
    const f = fixture()
    f.open(); f.controller.blur()
    const staleClose = f.callbacks.at(-1)!
    f.read(800); f.controller.focus(); f.sample(500)
    const count = f.writes.length
    staleClose(); f.controller.focus(); f.sample(500)
    assert.equal(f.writes.length, count)
    f.controller.blur()
    assert.equal(f.target()?.bottom, 800)
})

test("retiring a close never learns a half-closed viewport as the resting baseline", () => {
    const f = fixture()
    f.open(); f.controller.blur(); f.read(620)
    f.callbacks.at(-1)!()
    assert.equal(f.target()?.bottom, 800)
    f.controller.focus()
    assert.equal(f.target()?.bottom, 620)
    f.sample(500); f.controller.blur()
    assert.equal(f.target()?.bottom, 800)
})

test("progressive viewport movement is followed directly on opening and closing", () => {
    const f = fixture()
    f.controller.focus(); f.sample(798); f.sample(650); f.sample(500)
    assert.deepEqual(f.target(), { bottom: 500, animate: false })
    f.controller.blur(); f.sample(650)
    assert.deepEqual(f.target(), { bottom: 650, animate: false })
    f.sample(800)
    assert.deepEqual(f.target(), { bottom: 800, animate: false })
})

test("a closed viewport confirmation does not restart or cancel its running return animation", () => {
    const f = fixture()
    f.open(); f.controller.blur()
    const count = f.writes.length
    f.sample(800); f.controller.blur()
    assert.equal(f.writes.length, count)
    assert.deepEqual(f.target(), { bottom: 800, animate: true })
})

test("a fresh tap invalidates even an already queued background-resume callback", () => {
    const f = fixture()
    f.open(); f.controller.suspend(); f.read(800); f.controller.resume()
    const staleResume = f.callbacks.at(-1)!
    f.controller.focus(); f.sample(500)
    staleResume()
    assert.equal(f.target()?.bottom, 500)
    assert.equal(f.timers.size, 1)
})

test("dispose cancels background work and prevents subsequent viewport mutations", () => {
    const f = fixture()
    f.open(); f.controller.suspend(); f.controller.resume()
    const staleResume = f.callbacks.at(-1)!
    f.controller.dispose()
    const count = f.writes.length
    staleResume(); f.controller.focus(); f.sample(500)
    assert.equal(f.writes.length, count)
    assert.deepEqual(f.target(), { bottom: 800, animate: false })
})

test("unfocused viewport changes establish the next resting edge and desktop skips synthetic motion", () => {
    const f = fixture(false)
    f.sample(700); f.controller.focus(); f.sample(400)
    assert.deepEqual(f.target(), { bottom: 400, animate: false })
    f.controller.blur(); f.sample(700)
    assert.equal(f.target()?.bottom, 700)
})

test("invalid samples cannot collapse a focused chat or poison later valid geometry", () => {
    for (const invalid of [0, -100, NaN, Infinity]) {
        const f = fixture()
        f.open(); f.sample(invalid)
        assert.equal(f.target()?.bottom, 500)
        f.sample(500); f.settle()
        assert.equal(f.target()?.bottom, 500)
        f.sample(550)
        assert.equal(f.target()?.bottom, 550)
    }
})

test("an invalid initial measurement never writes an unusable viewport", () => {
    const f = fixture(true, NaN)
    assert.equal(f.writes.length, 0)
    f.controller.focus(); f.sample(500); f.settle()
    assert.equal(f.target()?.bottom, 500)
    f.controller.blur()
    assert.equal(f.target()?.bottom, 800)
})

test("opening rebound protection expires and keyboard changes track their current height", () => {
    const f = fixture()
    f.open(); f.sample(450); f.sample(520)
    assert.equal(f.target()?.bottom, 450)
    f.settle()
    assert.deepEqual(f.target(), { bottom: 520, animate: false })
    f.sample(560)
    assert.equal(f.target()?.bottom, 560)
    f.sample(440)
    assert.equal(f.target()?.bottom, 440)
})

test("a keyboard-only dismissal restores the viewport without requiring blur", () => {
    const f = fixture()
    f.open(); f.sample(800)
    assert.equal(f.target()?.bottom, 500) // Ignore a transient close sample.
    f.settle()
    assert.equal(f.target()?.bottom, 800)
    f.sample(500)
    assert.deepEqual(f.target(), { bottom: 500, animate: true })
})

test("metrics arriving after their final event receive one bounded confirmation", () => {
    const f = fixture()
    f.open(); f.read(530); f.settle()
    assert.equal(f.target()?.bottom, 500)
    assert.equal(f.timers.size, 1)
    f.settle()
    assert.equal(f.target()?.bottom, 530)
    assert.equal(f.timers.size, 0)
    f.sample(NaN); f.settle(); f.settle()
    assert.equal(f.timers.size, 0)
    assert.equal(f.target()?.bottom, 530)
})

test("a queued reconciliation cannot override a new focus, suspension, or disposal", () => {
    for (const action of ["reopen", "suspend", "dispose"]) {
        const f = fixture()
        f.open()
        const stale = f.callbacks.at(-1)!
        if (action === "reopen") { f.controller.blur(); f.read(620); f.controller.focus() }
        else if (action === "suspend") f.controller.suspend()
        else f.controller.dispose()
        const count = f.writes.length
        f.read(300); stale()
        assert.equal(f.writes.length, count)
    }
})

test("resuming during a keyboard dismissal cannot learn a half-height resting baseline", () => {
    const f = fixture()
    f.open(); f.controller.suspend(); f.controller.resume(); f.read(620)
    f.settle(); f.settle()
    assert.equal(f.target()?.bottom, 800)
    f.controller.focus(); f.sample(500); f.controller.blur()
    assert.equal(f.target()?.bottom, 800)
})

test("rotation with a focused composer establishes the new resting layout after settling", () => {
    const f = fixture()
    f.open(); f.settle(); f.resizeLayout(600); f.sample(320); f.settle()
    assert.equal(f.target()?.bottom, 320)
    f.controller.blur()
    assert.equal(f.target()?.bottom, 600)
})
