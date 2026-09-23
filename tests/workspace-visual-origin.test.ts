import assert from "node:assert/strict"
import test from "node:test"
import { createWorkspaceVisualOrigin } from "../lib/workspace-visual-origin.ts"

test("measured native pan is corrected without changing document scroll or focus", () => {
    let pan = 0, offset = 0, frame = 0, next = 0
    const frames = new Map<number, () => void>()
    const writes: number[] = []
    const origin = createWorkspaceVisualOrigin({
        readTop: () => offset - pan,
        readLimit: () => 400,
        writeOffset: (value) => { offset = value; writes.push(value) },
        requestFrame: (callback) => { frames.set(++next, callback); frame = next; return next },
        cancelFrame: (id) => { frames.delete(id) },
    })
    pan = 84
    origin.update()
    assert.equal(offset, 84)
    assert.equal(offset - pan, 0)
    const settled = frames.get(frame)
    frames.delete(frame)
    settled?.()
    assert.deepEqual(writes, [84])
    pan = 0
    origin.update()
    assert.equal(offset, 0)
    assert.equal(frames.size, 1)
    origin.dispose()
})

test("late viewport metrics, invalid samples and teardown cannot retain correction", () => {
    let pan = 0, offset = 0, enabled = true, next = 0
    const frames = new Map<number, () => void>()
    const origin = createWorkspaceVisualOrigin({
        readTop: () => Number.isFinite(pan) ? offset - pan : NaN,
        readLimit: () => enabled ? 400 : 0,
        writeOffset: (value) => { offset = value },
        requestFrame: (callback) => { frames.set(++next, callback); return next },
        cancelFrame: (id) => { frames.delete(id) },
    })
    origin.update()
    pan = 96
    const late = frames.get(next)!
    frames.delete(next)
    late()
    assert.equal(offset, 96)
    pan = NaN
    origin.update()
    assert.equal(offset, 96)
    enabled = false
    origin.update()
    assert.equal(offset, 0)
    pan = 100
    const stale = frames.get(next)!
    origin.dispose()
    stale()
    assert.equal(offset, 0)
    assert.equal(frames.size, 0)
})

test("repeated keyboard transitions do not accumulate offset", () => {
    let pan = 0, offset = 0, next = 0
    const frames = new Map<number, () => void>()
    const origin = createWorkspaceVisualOrigin({
        readTop: () => offset - pan,
        readLimit: () => 400,
        writeOffset: (value) => { offset = value },
        requestFrame: (callback) => { frames.set(++next, callback); return next },
        cancelFrame: (id) => { frames.delete(id) },
    })
    for (let i = 0; i < 250; i++) {
        pan = i % 2 ? 0 : 84
        origin.update()
        assert.equal(offset, pan)
        assert.equal(offset - pan, 0)
        assert.equal(frames.size, 1)
    }
    origin.suspend()
    assert.equal(frames.size, 0)
    pan = 0
    origin.update()
    assert.equal(offset, 0)
    origin.resume()
    assert.equal(offset, 0)
    origin.dispose()
})

test("desktop or zoom disables correction and cancels the prior mobile offset", () => {
    const pan = 90
    let offset = 0, limit = 400, next = 0
    const origin = createWorkspaceVisualOrigin({
        readTop: () => offset - pan,
        readLimit: () => limit,
        writeOffset: (value) => { offset = value },
        requestFrame: () => ++next,
        cancelFrame: () => {},
    })
    origin.update()
    assert.equal(offset, 90)
    limit = 0 // Host readLimit returns zero on desktop or native zoom.
    origin.update()
    assert.equal(offset, 0)
    origin.dispose()
})
