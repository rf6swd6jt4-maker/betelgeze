import assert from "node:assert/strict"
import test from "node:test"
import {
    MOBILE_CONVERSATION_VISIBILITY_EVENT,
    mobileConversationBounds,
    mobileConversationIsOpen,
    observeMobileConversationViewport,
    ownMobileConversation,
} from "../lib/mobile-conversation-viewport.ts"

class TrackedEvents extends EventTarget {
    listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
    override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
        if (listener) {
            const entries = this.listeners.get(type) ?? new Set()
            entries.add(listener)
            this.listeners.set(type, entries)
        }
        super.addEventListener(type, listener, options)
    }
    override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
        if (listener) this.listeners.get(type)?.delete(listener)
        super.removeEventListener(type, listener, options)
    }
    get listenerCount() { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0) }
}

class ElementFixture extends TrackedEvents {
    dataset: Record<string, string> = {}
    attributes = new Map<string, string>()
    properties = new Map<string, string>()
    inert = false
    panes: ElementFixture[] = []
    style = {
        setProperty: (name: string, value: string) => { this.properties.set(name, value) },
        removeProperty: (name: string) => { const previous = this.properties.get(name) ?? ""; this.properties.delete(name); return previous },
    }
    private dataKey(name: string) { return name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()) }
    getAttribute(name: string) { return name.startsWith("data-") ? this.dataset[this.dataKey(name)] ?? null : this.attributes.get(name) ?? null }
    setAttribute(name: string, value: string) {
        if (name.startsWith("data-")) this.dataset[this.dataKey(name)] = value
        else this.attributes.set(name, value)
    }
    removeAttribute(name: string) {
        if (name.startsWith("data-")) delete this.dataset[this.dataKey(name)]
        else this.attributes.delete(name)
    }
    querySelectorAll(selector: string) { assert.equal(selector, "[data-message-pane]"); return this.panes }
}

function fixture() {
    const html = new ElementFixture()
    const background = [new ElementFixture(), new ElementFixture(), new ElementFixture()]
    const documentEvents = new TrackedEvents()
    const document = Object.assign(documentEvents, {
        documentElement: html,
        visibilityState: "visible",
        querySelectorAll: (selector: string) => {
            assert.equal(selector, "[data-workspace-topbar], [data-workspace-tabbar], [data-workspace-tab-panels]")
            return background
        },
    })
    const viewport = Object.assign(new TrackedEvents(), { offsetTop: 0, pageTop: 0, height: 812, scale: 1 })
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    const windowEvents = new TrackedEvents()
    const view = Object.assign(windowEvents, {
        document,
        visualViewport: viewport as typeof viewport | null,
        innerHeight: 812,
        scrollY: 0,
        requestAnimationFrame: (callback: FrameRequestCallback) => { const id = ++frameId; frames.set(id, callback); return id },
        cancelAnimationFrame: (id: number) => { frames.delete(id) },
    })
    const root = new ElementFixture()
    const pane = new ElementFixture()
    root.panes.push(pane)
    const flushFrame = () => {
        const pending = [...frames.values()]
        frames.clear()
        pending.forEach(callback => callback(0))
    }
    return { view: view as unknown as Window, rawView: view, html, background, document, viewport, frames, root, pane, flushFrame }
}

test("absolute bounds use pageTop directly despite divergent legacy and visual offsets", () => {
    const f = fixture()
    for (const sample of [
        { pageTop: 396, offsetTop: 396, scrollY: 396 },
        { pageTop: 396, offsetTop: 0, scrollY: 396 },
        { pageTop: 220, offsetTop: 120, scrollY: 100 },
        { pageTop: 80, offsetTop: 300, scrollY: 600 },
    ]) {
        Object.assign(f.viewport, sample, { height: 416 })
        f.rawView.scrollY = sample.scrollY
        assert.deepEqual(mobileConversationBounds(f.view), { top: sample.pageTop, height: 416 })
    }
})

test("invalid document origins, heights and scales are rejected without synthesizing an origin", () => {
    const f = fixture()
    for (const sample of [
        { pageTop: -1 }, { pageTop: NaN }, { pageTop: Infinity }, { pageTop: null },
        { height: 0 }, { height: -1 }, { height: NaN }, { height: null },
        { scale: 0 }, { scale: 1.5 }, { scale: NaN }, { scale: null },
    ]) {
        Object.assign(f.viewport, { pageTop: 0, height: 812, scale: 1, offsetTop: 0 }, sample)
        assert.equal(mobileConversationBounds(f.view), null, `Invalid sample: ${JSON.stringify(sample)}`)
    }
    f.rawView.visualViewport = null
    f.rawView.scrollY = 123
    assert.deepEqual(mobileConversationBounds(f.view), { top: 123, height: 812 })
    f.rawView.scrollY = -1
    assert.equal(mobileConversationBounds(f.view), null)
})

test("document panning changes absolute origin even when the visual viewport offset is unchanged", () => {
    const f = fixture()
    const stop = observeMobileConversationViewport(f.view, f.root as unknown as HTMLElement)
    f.flushFrame()
    f.viewport.pageTop = 396
    f.rawView.scrollY = 396
    f.viewport.dispatchEvent(new Event("scroll"))
    assert.equal(f.root.properties.get("--conversation-viewport-top"), "396px")
    stop()
})

test("a conversation uses the full visual height and changes origin without adding shell offsets", () => {
    const f = fixture()
    const observed: Array<[string, string | undefined, string | undefined]> = []
    for (const event of ["conversation-layout-will-change", "conversation-layout-commit"]) {
        f.pane.addEventListener(event, () => observed.push([event, f.root.properties.get("--conversation-viewport-top"), f.root.properties.get("--conversation-viewport-height")]))
    }
    const stop = observeMobileConversationViewport(f.view, f.root as unknown as HTMLElement)
    f.flushFrame()
    observed.length = 0
    f.viewport.height = 416
    f.viewport.pageTop = 396
    f.viewport.offsetTop = 120
    f.rawView.scrollY = 276
    f.viewport.dispatchEvent(new Event("resize"))
    assert.deepEqual(observed, [
        ["conversation-layout-will-change", "0px", "812px"],
        ["conversation-layout-commit", "396px", "416px"],
    ])
    assert.equal(f.frames.size, 1)
    f.flushFrame()
    assert.equal(observed.length, 2, "an unchanged next-frame measurement must not repeat layout commits")
    stop()
})

test("viewport bursts apply immediately and retain only one bounded next-frame reread", () => {
    const f = fixture()
    const stop = observeMobileConversationViewport(f.view, f.root as unknown as HTMLElement)
    for (const [height, top] of [[600, 100], [490, 220], [416, 396]]) {
        f.viewport.height = height
        f.viewport.pageTop = top
        f.viewport.dispatchEvent(new Event("scroll"))
        assert.equal(f.root.properties.get("--conversation-viewport-height"), `${height}px`)
        assert.equal(f.root.properties.get("--conversation-viewport-top"), `${top}px`)
        assert.equal(f.frames.size, 1)
    }
    f.flushFrame()
    assert.equal(f.frames.size, 0, "the viewport owner must not create a polling loop")
    stop()
})

test("invalid and zoomed samples retain last valid geometry and hidden documents do not update", () => {
    const f = fixture()
    const stop = observeMobileConversationViewport(f.view, f.root as unknown as HTMLElement)
    f.flushFrame()
    for (const sample of [{ height: 0, pageTop: 0, scale: 1 }, { height: 416, pageTop: -1, scale: 1 }, { height: 416, pageTop: 396, scale: 1.5 }]) {
        Object.assign(f.viewport, sample)
        f.viewport.dispatchEvent(new Event("resize"))
        f.flushFrame()
        assert.equal(f.root.properties.get("--conversation-viewport-height"), "812px")
        assert.equal(f.root.properties.get("--conversation-viewport-top"), "0px")
    }
    Object.assign(f.viewport, { height: 416, pageTop: 396, scale: 1 })
    f.document.visibilityState = "hidden"
    f.document.dispatchEvent(new Event("visibilitychange"))
    assert.equal(f.frames.size, 0)
    assert.equal(f.root.properties.get("--conversation-viewport-height"), "812px")
    f.document.visibilityState = "visible"
    f.document.dispatchEvent(new Event("visibilitychange"))
    assert.equal(f.root.properties.get("--conversation-viewport-height"), "416px")
    assert.equal(f.root.properties.get("--conversation-viewport-top"), "396px")
    stop()
})

test("without VisualViewport the conversation uses current window height and releases every observer", () => {
    const f = fixture()
    f.rawView.visualViewport = null
    f.rawView.innerHeight = 700
    f.rawView.scrollY = 120
    const stop = observeMobileConversationViewport(f.view, f.root as unknown as HTMLElement)
    assert.equal(f.root.properties.get("--conversation-viewport-height"), "700px")
    f.rawView.innerHeight = 390
    f.view.dispatchEvent(new Event("resize"))
    assert.equal(f.root.properties.get("--conversation-viewport-height"), "390px")
    assert.equal(f.root.properties.get("--conversation-viewport-top"), "120px")
    assert.equal(f.frames.size, 1)
    stop()
    assert.equal(f.frames.size, 0)
    assert.equal(f.root.properties.size, 0)
    assert.equal(f.rawView.listenerCount, 0)
    assert.equal(f.document.listenerCount, 0)
    f.view.dispatchEvent(new Event("resize"))
    assert.equal(f.root.properties.size, 0)
})

test("cleanup removes visual viewport listeners and pending writes", () => {
    const f = fixture()
    const stop = observeMobileConversationViewport(f.view, f.root as unknown as HTMLElement)
    assert.equal(f.viewport.listenerCount, 3)
    stop()
    assert.equal(f.viewport.listenerCount, 0)
    assert.equal(f.rawView.listenerCount, 0)
    assert.equal(f.document.listenerCount, 0)
    f.viewport.height = 300
    f.viewport.dispatchEvent(new Event("resize"))
    f.flushFrame()
    assert.equal(f.root.properties.size, 0)
})

test("document scroll and scroll-end events reconcile origins without a viewport resize", () => {
    const f = fixture()
    const stop = observeMobileConversationViewport(f.view, f.root as unknown as HTMLElement)
    f.flushFrame()
    const sources: Array<[EventTarget, string]> = [[f.view, "scroll"], [f.view, "scrollend"], [f.viewport, "scrollend"]]
    for (let index = 0; index < sources.length; index++) {
        const pageTop = 80 * (index + 1)
        f.viewport.pageTop = pageTop
        f.rawView.scrollY = pageTop
        sources[index][0].dispatchEvent(new Event(sources[index][1]))
        assert.equal(f.root.properties.get("--conversation-viewport-top"), `${pageTop}px`)
        assert.equal(f.root.properties.get("--conversation-viewport-height"), "812px")
        assert.equal(f.frames.size, 1)
        f.flushFrame()
    }
    stop()
})

test("one next-frame reread catches viewport metrics delivered after the event", () => {
    const f = fixture()
    const stop = observeMobileConversationViewport(f.view, f.root as unknown as HTMLElement)
    f.flushFrame()
    f.viewport.dispatchEvent(new Event("resize"))
    assert.equal(f.root.properties.get("--conversation-viewport-top"), "0px")
    Object.assign(f.viewport, { pageTop: 396, height: 416 })
    f.flushFrame()
    assert.equal(f.root.properties.get("--conversation-viewport-top"), "396px")
    assert.equal(f.root.properties.get("--conversation-viewport-height"), "416px")
    assert.equal(f.frames.size, 0)
    stop()
})

test("repeated keyboard open and close cycles never accumulate origin compensation", () => {
    const f = fixture()
    const stop = observeMobileConversationViewport(f.view, f.root as unknown as HTMLElement)
    for (let cycle = 0; cycle < 40; cycle++) {
        Object.assign(f.viewport, { pageTop: 396, offsetTop: 396, height: 416 })
        f.rawView.scrollY = 396
        f.viewport.dispatchEvent(new Event("resize"))
        f.flushFrame()
        assert.equal(f.root.properties.get("--conversation-viewport-top"), "396px")
        assert.equal(f.root.properties.get("--conversation-viewport-height"), "416px")
        Object.assign(f.viewport, { pageTop: 0, offsetTop: 0, height: 812 })
        f.rawView.scrollY = 0
        f.view.dispatchEvent(new Event("scrollend"))
        f.flushFrame()
        assert.equal(f.root.properties.get("--conversation-viewport-top"), "0px")
        assert.equal(f.root.properties.get("--conversation-viewport-height"), "812px")
        assert.equal(f.frames.size, 0)
    }
    stop()
})

test("hiding immediately cancels a pending reread and resuming reads current metrics", () => {
    const f = fixture()
    const stop = observeMobileConversationViewport(f.view, f.root as unknown as HTMLElement)
    assert.equal(f.frames.size, 1)
    f.document.visibilityState = "hidden"
    f.document.dispatchEvent(new Event("visibilitychange"))
    assert.equal(f.frames.size, 0)
    Object.assign(f.viewport, { pageTop: 200, height: 500 })
    f.view.dispatchEvent(new Event("scroll"))
    f.flushFrame()
    assert.equal(f.root.properties.get("--conversation-viewport-top"), "0px")
    f.document.visibilityState = "visible"
    f.view.dispatchEvent(new Event("pageshow"))
    assert.equal(f.root.properties.get("--conversation-viewport-top"), "200px")
    assert.equal(f.root.properties.get("--conversation-viewport-height"), "500px")
    stop()
    assert.equal(f.frames.size, 0)
})

test("ownership publishes complete handoff state and restores exact background accessibility state", () => {
    const f = fixture()
    f.background[1].inert = true
    f.background[1].setAttribute("aria-hidden", "true")
    f.background[2].setAttribute("aria-hidden", "false")
    const states: Array<{ open: boolean; phase: string | null; background: Array<[boolean, string | null]> }> = []
    f.view.addEventListener(MOBILE_CONVERSATION_VISIBILITY_EVENT, () => states.push({
        open: mobileConversationIsOpen(f.view),
        phase: f.html.getAttribute("data-mobile-conversation-phase"),
        background: f.background.map(element => [element.inert, element.getAttribute("aria-hidden")]),
    }))
    const owner = ownMobileConversation(f.view, "entering")
    assert.deepEqual(states, [{ open: true, phase: "entering", background: [[true, "true"], [true, "true"], [true, "true"]] }])
    owner.phase("open")
    assert.equal(f.html.dataset.mobileConversationPhase, "open")
    owner.phase("leaving")
    assert.equal(f.html.dataset.mobileConversationPhase, "leaving")
    owner.release()
    assert.deepEqual(states[1], { open: false, phase: null, background: [[false, null], [true, "true"], [false, "false"]] })
    owner.release()
    owner.phase("open")
    assert.equal(states.length, 2, "releasing twice must not duplicate the shell restoration event")
    assert.equal(f.html.getAttribute("data-mobile-conversation-phase"), null)
})

test("ownership preserves pre-existing document attributes when it releases", () => {
    const f = fixture()
    f.html.setAttribute("data-mobile-conversation-open", "false")
    f.html.setAttribute("data-mobile-conversation-phase", "previous")
    const owner = ownMobileConversation(f.view, "entering")
    owner.release()
    assert.equal(f.html.getAttribute("data-mobile-conversation-open"), "false")
    assert.equal(f.html.getAttribute("data-mobile-conversation-phase"), "previous")
})
