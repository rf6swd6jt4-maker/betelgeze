import assert from "node:assert/strict"
import test from "node:test"
import { MessageReferenceObservation } from "../lib/communications/reference-observation.ts"
import type { RecordReference } from "../lib/chat-formatting.ts"

const reference: RecordReference = { type: "asset", id: "00000000-0000-4000-8000-000000000001" }
function fixture() {
    const callbacks: IntersectionObserverCallback[] = []
    const focus = new Set<() => void>()
    const resolved: RecordReference[] = []
    let disconnected = 0, clears = 0
    const owner = new MessageReferenceObservation({ setActive: () => {}, clear: () => { clears++ }, resolve: record => { resolved.push(record) } }, {
        createObserver: callback => { callbacks.push(callback); return { observe: () => {}, unobserve: () => {}, disconnect: () => { disconnected++ } } },
        listenForFocus: callback => { focus.add(callback); return () => { focus.delete(callback) } },
    })
    const enter = (element: HTMLElement, index = callbacks.length - 1) => callbacks[index]([{ target: element, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    return { owner, callbacks, focus, resolved, enter, get disconnected() { return disconnected }, get clears() { return clears } }
}

test("ordinary chat activation, typing and departure create no reference observer or focus listener", () => {
    const f = fixture()
    f.owner.setActive(true)
    f.owner.resolveDraft([])
    f.owner.clearDraft()
    f.owner.setActive(false)
    f.owner.setActive(true)
    assert.equal(f.callbacks.length, 0)
    assert.equal(f.focus.size, 0)
    assert.equal(f.resolved.length, 0)
})

test("the first actual reference owns one observer, last removal disposes it, and queued old callbacks stay inert", () => {
    const f = fixture()
    const element = {} as HTMLElement
    f.owner.setActive(true)
    const stop = f.owner.observe(element, reference)
    assert.equal(f.callbacks.length, 1)
    assert.equal(f.focus.size, 1)
    assert.equal(f.resolved.length, 0)
    f.enter(element)
    assert.deepEqual(f.resolved, [reference])
    stop()
    assert.equal(f.disconnected, 1)
    assert.equal(f.focus.size, 0)
    f.owner.observe(element, reference)
    f.enter(element, 0)
    assert.equal(f.resolved.length, 1)
    f.enter(element, 1)
    assert.equal(f.resolved.length, 2)
    f.owner.setActive(false)
    assert.equal(f.focus.size, 0)
})

test("a focused draft gets a retry listener without an intersection observer and releases it on blur", () => {
    const f = fixture()
    f.owner.setActive(true)
    f.owner.resolveDraft([reference])
    assert.equal(f.callbacks.length, 0)
    assert.equal(f.focus.size, 1)
    assert.deepEqual(f.resolved, [reference])
    for (const callback of f.focus) callback()
    assert.equal(f.clears, 1)
    assert.deepEqual(f.resolved, [reference, reference])
    f.owner.clearDraft()
    assert.equal(f.focus.size, 0)
})

test("inactive registrations perform no work until activation and deactivation clears focused draft intent", () => {
    const f = fixture()
    const element = {} as HTMLElement
    const stop = f.owner.observe(element, reference)
    f.owner.resolveDraft([reference])
    assert.equal(f.callbacks.length, 0)
    assert.equal(f.focus.size, 0)
    assert.equal(f.resolved.length, 0)
    f.owner.setActive(true)
    assert.equal(f.callbacks.length, 1)
    f.owner.resolveDraft([reference])
    f.owner.setActive(false)
    f.enter(element)
    assert.equal(f.resolved.length, 1)
    stop()
    f.owner.setActive(true)
    assert.equal(f.focus.size, 0)
    assert.equal(f.callbacks.length, 1)
})
