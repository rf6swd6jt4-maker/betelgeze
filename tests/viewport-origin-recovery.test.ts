import assert from "node:assert/strict"
import test from "node:test"
import { createViewportOriginRecovery } from "../lib/viewport-origin-recovery.ts"

function fixture() {
    let resting = true
    let writes = 0
    let nextFrame = 0
    const frames = new Map<number, () => void>()
    const history: (() => void)[] = []
    const recovery = createViewportOriginRecovery({
        canRestore: () => resting,
        restore: () => { writes++ },
        requestFrame: (callback) => {
            frames.set(++nextFrame, callback)
            history.push(callback)
            return nextFrame
        },
        cancelFrame: (frame) => { frames.delete(frame) },
    })
    return {
        recovery, history,
        setResting: (value: boolean) => { resting = value },
        writes: () => writes,
        pending: () => frames.size,
        tick: () => {
            const callbacks = [...frames.values()]
            frames.clear()
            callbacks.forEach((callback) => callback())
        },
    }
}

test("origin recovery waits for two resting frames and does not poll", () => {
    const f = fixture()
    f.recovery.update()
    assert.equal(f.writes(), 0)
    f.tick()
    assert.equal(f.writes(), 0)
    f.tick()
    assert.equal(f.writes(), 1)
    assert.equal(f.pending(), 0)
})

test("focus and keyboard viewport events never reset the document scroll", () => {
    const f = fixture()
    f.recovery.focus()
    // A trailing full-height sample can arrive after a new focus.
    for (let i = 0; i < 20; i++) {
        f.setResting(i % 2 === 0)
        f.recovery.update()
        f.tick()
        f.tick()
    }
    assert.equal(f.writes(), 0)
    assert.equal(f.pending(), 0)
})

test("blur waits for the keyboard to finish closing before restoring scroll", () => {
    const f = fixture()
    f.recovery.focus()
    f.setResting(false)
    f.recovery.blur()
    f.tick()
    f.tick()
    assert.equal(f.writes(), 0)
    assert.equal(f.pending(), 0)
    f.setResting(true)
    f.recovery.update()
    f.tick()
    f.tick()
    assert.equal(f.writes(), 1)
})

test("rapid reopening cancels recovery even after its first resting frame", () => {
    const f = fixture()
    f.recovery.focus()
    f.recovery.blur()
    f.tick()
    const staleCallback = f.history.at(-1)!
    f.recovery.focus()
    f.tick()
    staleCallback()
    assert.equal(f.writes(), 0)
    assert.equal(f.pending(), 0)
})

test("a viewport change between frames invalidates the earlier observation", () => {
    const f = fixture()
    f.recovery.update()
    f.tick()
    const staleCallback = f.history.at(-1)!
    f.setResting(false)
    f.recovery.update()
    staleCallback()
    f.tick()
    assert.equal(f.writes(), 0)
    assert.equal(f.pending(), 0)
})

test("metrics updated after the resize event are checked again before writing", () => {
    const f = fixture()
    f.recovery.update()
    f.tick()
    f.setResting(false)
    f.tick()
    assert.equal(f.writes(), 0)
})

test("suspension and teardown cannot run stale origin corrections", () => {
    const f = fixture()
    f.recovery.update()
    f.recovery.suspend()
    f.recovery.blur()
    f.history.forEach((callback) => callback())
    assert.equal(f.pending(), 0)
    assert.equal(f.writes(), 0)
    f.recovery.resume()
    f.tick()
    f.recovery.dispose()
    f.history.forEach((callback) => callback())
    f.recovery.update()
    assert.equal(f.writes(), 0)
    assert.equal(f.pending(), 0)
})

test("repeated close and reopen bursts only recover after the final close", () => {
    const f = fixture()
    for (let i = 0; i < 50; i++) {
        f.recovery.focus()
        f.setResting(false)
        f.recovery.update()
        f.recovery.blur()
        f.setResting(true)
        f.recovery.update()
        if (i % 2) f.tick()
    }
    assert.equal(f.writes(), 0)
    f.tick()
    f.tick()
    assert.equal(f.writes(), 1)
    assert.equal(f.pending(), 0)
})
