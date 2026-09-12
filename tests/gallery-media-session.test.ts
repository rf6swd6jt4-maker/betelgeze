import assert from "node:assert/strict"
import test from "node:test"
import { createGalleryMediaSession, galleryMediaCost } from "../lib/communications/gallery-media-session.ts"

const image = { size: 1000, width: 640, height: 480 }
const items = Array.from({ length: 5 }, () => ({ ...image }))
const open = (list = items, budget?: number) => createGalleryMediaSession(list, 0, () => {}, budget)

test("selected loads first, followed by one original at a time; returning retains loaded items", () => {
    const session = open()
    assert.deepEqual(session.getSnapshot().resident, [0])
    session.settle(0)
    assert.equal(session.getSnapshot().pending, 1)
    session.settle(1)
    assert.equal(session.getSnapshot().pending, 2)
    session.select(1)
    assert.ok(session.getSnapshot().resident.includes(0))
    session.select(0)
    assert.ok(session.getSnapshot().resident.includes(1))
})

test("selecting a pending item promotes it, while selecting elsewhere cancels speculation", () => {
    const session = open()
    session.settle(0)
    session.select(1)
    assert.deepEqual(session.getSnapshot().resident, [0, 1])
    assert.equal(session.getSnapshot().pending, null)
    session.settle(1)
    assert.equal(session.getSnapshot().pending, 2)
    session.select(4)
    assert.ok(!session.getSnapshot().resident.includes(2))
    assert.equal(session.getSnapshot().pending, null)
    session.settle(2) // completion from the cancelled element
    assert.equal(session.getSnapshot().pending, null)
    session.settle(4)
    assert.equal(session.getSnapshot().pending, 3)
})

test("budget stops speculation, evicts old residents only for selection, and allows a large selected file", () => {
    const cost = galleryMediaCost(image)
    const session = open(items, cost * 2)
    session.settle(0); session.settle(1)
    assert.equal(session.getSnapshot().pending, null)
    session.select(3)
    assert.deepEqual(session.getSnapshot().resident, [0, 3])
    const large = open([image, { ...image, size: cost * 10 }], cost * 2)
    large.settle(0)
    assert.equal(large.getSnapshot().pending, null)
    large.select(1)
    assert.deepEqual(large.getSnapshot().resident, [1])
})

test("hidden viewers and buffering playback cancel background loads and resume only when ready", () => {
    const session = open()
    session.settle(0)
    session.setEnabled(false)
    assert.deepEqual(session.getSnapshot().resident, [0])
    session.setEnabled(true)
    assert.equal(session.getSnapshot().pending, 1)
    session.wait(0)
    assert.equal(session.getSnapshot().pending, null)
    session.settle(1)
    assert.equal(session.getSnapshot().pending, null)
    session.settle(0)
    assert.equal(session.getSnapshot().pending, 1)
})

test("failed or stalled speculation does not retry indefinitely or block other items", () => {
    const session = open()
    session.settle(0)
    session.timeout(1)
    assert.equal(session.getSnapshot().pending, 2)
    session.settle(2, false)
    assert.equal(session.getSnapshot().pending, 3)
    session.timeout(1) // stale deadline cannot cancel the next item
    assert.equal(session.getSnapshot().pending, 3)
    session.select(1) // an explicit selection still allows a retry
    assert.ok(session.getSnapshot().resident.includes(1))
})

test("unknown sizes/dimensions are on demand; disposal ignores late completions", () => {
    const session = open([image, { ...image, size: 0 }, { ...image, width: 0 }])
    session.settle(0)
    assert.equal(session.getSnapshot().pending, null)
    session.select(1)
    assert.ok(session.getSnapshot().resident.includes(1))
    const last = session.getSnapshot()
    session.dispose(); session.settle(1); session.select(2)
    assert.equal(session.getSnapshot(), last)
})

test("returning to a failed selected item retries it instead of retaining a broken element", () => {
    const session = open()
    session.settle(0, false)
    session.select(1)
    assert.ok(!session.getSnapshot().resident.includes(0))
    session.select(0)
    assert.ok(session.getSnapshot().resident.includes(0))
    assert.equal(session.getSnapshot().pending, null)
    session.settle(0)
    session.select(1)
    assert.ok(session.getSnapshot().resident.includes(0))
})

test("rapid selection cancels unfinished former selections as well as speculation", () => {
    const session = open()
    session.select(1)
    session.select(4)
    assert.deepEqual(session.getSnapshot().resident, [4])
    session.settle(0); session.settle(1)
    assert.equal(session.getSnapshot().pending, null)
    session.settle(4)
    assert.equal(session.getSnapshot().pending, 3)
})
