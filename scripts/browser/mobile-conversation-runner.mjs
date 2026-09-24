import React, { useLayoutEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { MobileConversationSurface } from "./MobileConversationSurface.js"
import { ChatMotionViewport } from "./ChatMotionViewport.js"
import { ComposerFooter } from "./ComposerFooter.js"
import { requestChatViewportMotion } from "./chat-viewport-motion.js"

const h = React.createElement
const assert = (value, message) => { if (!value) throw Error(message) }
const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1.5, `${message}: ${actual}; expected ${expected}`)
const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
const until = async (check, message) => { const deadline = performance.now() + 2500; while (!check()) { if (performance.now() > deadline) throw Error(message); await frame() } }
const cases = []
const define = (name, action) => cases.push({ name, action })
const painted = element => {
    if (getComputedStyle(element).visibility !== "visible") return false
    for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === "none" || Number(style.opacity) === 0) return false
    }
    return true
}

async function fixture() {
    const viewportDescriptor = Object.getOwnPropertyDescriptor(window, "visualViewport")
    const originalMatchMedia = window.matchMedia.bind(window)
    const mobile = Object.assign(new EventTarget(), { matches: true, media: "(max-width: 1023px)" })
    const reduction = Object.assign(new EventTarget(), { matches: false, media: "(prefers-reduced-motion: reduce)" })
    window.matchMedia = query => query === mobile.media ? mobile : query === reduction.media ? reduction : originalMatchMedia(query)
    const metrics = Object.assign(new EventTarget(), { pageTop: 0, offsetTop: 0, height: innerHeight, scale: 1, width: innerWidth, offsetLeft: 0 })
    Object.defineProperty(window, "visualViewport", { configurable: true, value: metrics })
    const story = {}, stage = document.querySelector("#stage"), root = createRoot(stage)
    function App() {
        const [selected, setSelected] = useState(false)
        const [active, setActive] = useState(true)
        const [draft, setDraft] = useState("")
        useLayoutEffect(() => { Object.assign(story, { setSelected, setActive, setDraft }) }, [])
        return h("div", { id: "fixture-shell", "data-workspace-shell-root": true },
            h("header", { "data-workspace-topbar": true }, "Synthetic workspace"),
            h("nav", { "data-workspace-tabbar": true }, "Comms"),
            h("main", { "data-workspace-tab-panels": true },
                h("div", { className: "fixture-columns" },
                    h("aside", { className: "fixture-list", "data-conversation-list": true }, Array.from({ length: 40 }, (_, i) => h("div", { className: "fixture-row", key: i }, h("button", { onClick: () => setSelected(true) }, `Synthetic chat ${i + 1}`)))),
                    h(MobileConversationSurface, { selected, active, onClose: () => setSelected(false) },
                        h("section", { className: "fixture-chat", "data-native-chat-viewport": true },
                            h("header", null, h("button", { "data-mobile-conversation-back": true, onClick: () => setSelected(false) }, "Back"), h("span", null, "Synthetic conversation")),
                            h(ChatMotionViewport, null,
                                h("div", { "data-message-pane": true }, Array.from({ length: 20 }, (_, i) => h("div", { key: i, className: "fixture-message" }, `Synthetic message ${i + 1}`))),
                                h(ComposerFooter, null, h("textarea", { "data-chat-composer": true, "aria-label": "Synthetic draft", value: draft, onChange: event => setDraft(event.target.value) }))))))))
    }
    flushSync(() => root.render(h(App)))
    await frame()
    const surface = document.querySelector(".mobile-conversation-surface")
    const list = stage.querySelector("[data-conversation-list]")
    const panSpace = document.createElement("div")
    panSpace.style.cssText = "position:absolute;top:0;left:0;width:1px;pointer-events:none;visibility:hidden"
    document.body.append(panSpace)
    const extendDocument = pageTop => { panSpace.style.height = `${pageTop + innerHeight + 4}px` }
    const q = selector => surface.querySelector(selector)
    const setMetrics = (values, event = "resize", source = metrics) => { Object.assign(metrics, values); source.dispatchEvent(new Event(event)) }
    const open = async () => { flushSync(() => story.setSelected(true)); await until(() => surface.dataset.phase === "open", "Surface did not finish entering"); await frame() }
    const resetPan = async () => { setMetrics({ pageTop: 0, offsetTop: 0, height: innerHeight, scale: 1 }); window.scrollTo(0, 0); await frame() }
    const back = async () => { await resetPan(); q("[data-mobile-conversation-back]").click(); await until(() => surface.hidden, "Back did not finish leaving"); await frame() }
    const setMobile = async value => { flushSync(() => { mobile.matches = value; mobile.dispatchEvent(new Event("change")) }); await frame(); await frame() }
    const documentPan = async (pageTop, offsetTop = 0, height = 416) => {
        setMetrics({ pageTop, offsetTop, height })
        // The synthetic keyboard does not shrink the engine's layout viewport.
        // Supply scroll extent; only the document scroll itself is native.
        extendDocument(pageTop)
        window.scrollTo(0, pageTop)
        window.dispatchEvent(new Event("scroll"))
        await frame(); await frame()
        near(scrollY, pageTop, "Fixture did not produce the requested native document scroll")
    }
    const geometry = async () => {
        await until(() => !q("[data-chat-motion-viewport]").dataset.chatViewportMoving, "Conversation motion did not settle")
        const rect = surface.getBoundingClientRect(), header = q("header").getBoundingClientRect(), footer = q("footer").getBoundingClientRect()
        near(rect.top, metrics.pageTop - scrollY, "Conversation lost its document-coordinate origin")
        near(rect.height, metrics.height, "Conversation consumed an origin as height")
        near(header.top, rect.top, "Conversation header separated from the frame")
        near(footer.bottom, rect.bottom, "Composer separated from the frame")
        return { pageTop: metrics.pageTop, offsetTop: metrics.offsetTop, scrollY, top: rect.top, height: rect.height, headerTop: header.top, footerBottom: footer.bottom }
    }
    return { story, surface, list, q, open, back, setMetrics, setMobile, documentPan, resetPan, geometry, metrics, extendDocument, reduction,
        async close() {
            flushSync(() => root.unmount())
            panSpace.remove()
            window.scrollTo(0, 0)
            window.matchMedia = originalMatchMedia
            if (viewportDescriptor) Object.defineProperty(window, "visualViewport", viewportDescriptor)
            else delete window.visualViewport
            await frame()
        },
    }
}

define("opening retains the list and presents an opaque untransformed conversation", async f => {
    const list = f.list
    await f.open()
    assert(list.isConnected && f.list === list, "Opening replaced the list")
    assert(f.surface.parentElement === document.body, "Conversation did not escape the shell")
    assert(getComputedStyle(f.surface).transform === "none", "Navigation transform remained after entry")
    assert(getComputedStyle(f.surface).backgroundColor === "rgb(0, 0, 0)", "Conversation background is not opaque")
    assert(getComputedStyle(document.querySelector("[data-workspace-topbar]")).visibility === "hidden", "Underlying shell remains paintable")
    return await f.geometry()
})
define("explicitly visible descendants cannot paint through the covered shell", async f => {
    const background = document.querySelector("[data-workspace-topbar]")
    const child = document.createElement("div")
    child.style.cssText = "visibility:visible;background:rgb(0,255,0);position:fixed;inset:0"
    background.append(child)
    try {
        await f.open()
        assert(!painted(child), "A child visibility override can still paint the underlying shell")
        f.setMetrics({ height: 416 }); await frame()
        f.q("textarea").focus({ preventScroll: true })
        f.q("[data-mobile-conversation-back]").click()
        assert(f.surface.dataset.phase === "dismissing-keyboard" && !painted(child), "Keyboard dismissal revealed underlying shell content")
        f.setMetrics({ height: innerHeight })
        assert(f.surface.dataset.phase === "leaving" && painted(child), "Back did not intentionally reveal the retained shell")
        await until(() => f.surface.hidden, "Back did not complete")
        assert(painted(child), "Back left the shell paint suppressed")
        return { descendantOverrideCovered: true, intentionalBackReveal: true }
    } finally { child.remove() }
})
define("a completed entrance cannot cancel a newer Back animation", async f => {
    flushSync(() => f.story.setSelected(true))
    const entry = f.surface.getAnimations()[0]
    assert(entry, "Entrance animation was not created")
    entry.finish()
    f.q("[data-mobile-conversation-back]").click()
    await until(() => f.surface.hidden, "An obsolete entrance completion stranded the surface after Back")
    assert(!document.documentElement.hasAttribute("data-mobile-conversation-open"), "Obsolete entrance reacquired shell ownership")
    return { obsoleteCompletionIgnored: true }
})
define("interrupting entrance with Back continues from the painted position", async f => {
    flushSync(() => f.story.setSelected(true))
    const entry = f.surface.getAnimations()[0]
    assert(entry, "Entrance animation was not created")
    entry.pause(); entry.currentTime = 80
    const before = f.surface.getBoundingClientRect().left
    f.q("[data-mobile-conversation-back]").click()
    const after = f.surface.getBoundingClientRect().left
    near(after, before, "Back jumped to a different horizontal position")
    assert(f.surface.getAnimations().length === 1, "Entry and exit animations overlap")
    await until(() => f.surface.hidden, "Interrupted entrance did not exit")
    return { before, after, simultaneousNavigationAnimations: 1 }
})
define("enabling reduced motion finishes an in-flight entrance or exit immediately", async f => {
    flushSync(() => f.story.setDraft("Reduced motion draft"))
    const editor = f.q("textarea")
    flushSync(() => f.story.setSelected(true))
    const entry = f.surface.getAnimations()[0]
    assert(entry, "Reduced-motion fixture did not start an entrance")
    entry.pause(); entry.currentTime = 60
    f.reduction.matches = true
    f.reduction.dispatchEvent(new Event("change"))
    await frame()
    assert(f.surface.dataset.phase === "open" && !f.surface.getAnimations().length,
        "Enabling reduced motion left the entrance in flight")
    near(f.surface.getBoundingClientRect().left, 0, "Reduced motion left a partial entrance transform")
    assert(!f.surface.inert && f.q("textarea") === editor && editor.value === "Reduced motion draft",
        "Reduced-motion entrance lost usability or the retained draft")
    f.reduction.matches = false
    f.reduction.dispatchEvent(new Event("change"))
    f.q("[data-mobile-conversation-back]").click()
    const exit = f.surface.getAnimations()[0]
    assert(exit, "Reduced-motion fixture did not start an exit")
    exit.pause(); exit.currentTime = 60
    f.reduction.matches = true
    f.reduction.dispatchEvent(new Event("change"))
    await frame()
    assert(f.surface.hidden && !f.surface.getAnimations().length,
        "Enabling reduced motion left the exit in flight")
    assert(!document.documentElement.hasAttribute("data-mobile-conversation-open"),
        "Reduced-motion exit stranded shell ownership")
    return { entranceCompleted: true, exitCompleted: true, draftRetained: true }
})
define("surface uses absolute document coordinates and escapes inline body clipping", async f => {
    await f.open()
    assert(getComputedStyle(f.surface).position === "absolute", "Surface retained fixed positioning")
    assert(document.body.style.overflow === "hidden", "Fixture lost the inline shell overflow condition")
    assert(getComputedStyle(document.body).overflow === "visible", "Inline body overflow clips the surface")
    assert(getComputedStyle(document.body).position === "static", "Body still establishes a positioned origin")
    return await f.geometry()
})
define("native document pan with zero visual offset preserves the header and composer", async f => {
    await f.open(); await f.documentPan(396, 0)
    const result = await f.geometry()
    near(result.headerTop, 0, "Header disappeared during document pan")
    near(result.footerBottom, 416, "Composer missed the keyboard edge")
    return result
})
define("equal pageTop offsetTop and scrollY are never added together", async f => {
    await f.open(); await f.documentPan(396, 396)
    near(parseFloat(f.surface.style.getPropertyValue("--conversation-viewport-top")), 396, "Pan was counted twice")
    return await f.geometry()
})
define("a document scroll updates pageTop while offsetTop and height stay constant", async f => {
    await f.open(); await f.documentPan(100, 0)
    Object.assign(f.metrics, { pageTop: 260 })
    f.extendDocument(260)
    window.dispatchEvent(new Event("scroll"))
    window.scrollTo(0, 260)
    window.dispatchEvent(new Event("scroll"))
    await frame(); await frame()
    near(parseFloat(f.surface.style.getPropertyValue("--conversation-viewport-top")), 260, "Document-only event was ignored")
    return await f.geometry()
})
define("fixed-position control exposes a document versus viewport origin mismatch", async f => {
    await f.open(); await f.documentPan(396, 396)
    const control = document.createElement("div")
    control.style.cssText = "position:fixed;top:396px;left:0;height:416px;width:1px;pointer-events:none"
    document.body.append(control)
    const actualTop = f.surface.getBoundingClientRect().top, controlTop = control.getBoundingClientRect().top
    control.remove()
    near(actualTop, 0, "Absolute candidate did not remain aligned")
    assert(Math.abs(controlTop - actualTop) > 300, "Fixed control did not expose the mismatched coordinate pair")
    return { actualTop, fixedControlTop: controlTop, limits: "Fixed+document-origin control, not a replay of an iOS compositor." }
})
define("invalid and zoomed metrics retain the frame then recover on a valid sample", async f => {
    await f.open(); f.setMetrics({ pageTop: 80, height: 500 }); await frame()
    for (const sample of [{ pageTop: -1 }, { pageTop: 80, height: 0 }, { height: 500, scale: 1.5 }]) {
        f.setMetrics(sample); await frame()
        near(parseFloat(f.surface.style.getPropertyValue("--conversation-viewport-top")), 80, "Invalid sample changed origin")
        near(f.surface.getBoundingClientRect().height, 500, "Invalid sample changed usable height")
    }
    f.setMetrics({ pageTop: 0, offsetTop: 0, height: innerHeight, scale: 1 }); await frame()
    return await f.geometry()
})
define("Back restores the same list scroll and reopening preserves its draft", async f => {
    f.list.scrollTop = 480
    await f.open()
    flushSync(() => f.story.setDraft("One two three\nA retained draft"))
    const editor = f.q("textarea")
    await f.back()
    assert(f.list.isConnected && f.list.scrollTop === 480, "Back reset the retained list")
    assert(!document.documentElement.hasAttribute("data-mobile-conversation-open"), "Back leaked viewport ownership")
    await f.open()
    assert(f.q("textarea") === editor && editor.value === "One two three\nA retained draft", "Back/reopen replaced editor or draft")
    return { listScroll: f.list.scrollTop, draftPreserved: true }
})
define("Back holds coverage until a modeled open keyboard returns to full height", async f => {
    await f.open(); f.setMetrics({ height: 416 }); await frame()
    f.q("textarea").focus({ preventScroll: true })
    f.q("[data-mobile-conversation-back]").click()
    assert(f.surface.dataset.phase === "dismissing-keyboard", "Back did not wait for keyboard dismissal")
    assert(!f.surface.hidden && f.surface.inert, "Closing lost opaque or interaction coverage")
    f.setMetrics({ pageTop: 0, offsetTop: 0, height: innerHeight })
    await until(() => f.surface.hidden, "Closing did not finish after keyboard dismissal")
    return { keyboardDismissalHandoff: true }
})
define("desktop mobile desktop handoff retains editor and switches footer ownership", async f => {
    await f.setMobile(false)
    flushSync(() => f.story.setSelected(true))
    flushSync(() => f.story.setDraft("Breakpoint draft"))
    await frame(); await frame()
    const editor = f.q("textarea"), slot = f.q("[data-composer-slot]")
    assert(f.surface.parentElement !== document.body && slot.style.height, "Desktop footer owner was not installed")
    await f.setMobile(true)
    await until(() => f.surface.dataset.phase === "open", "Mobile transition did not finish")
    assert(!slot.style.height && !slot.style.transition, "Mobile retained legacy footer sizing")
    const clip = f.q("[data-chat-motion-viewport]")
    requestChatViewportMotion(clip, 844, 500, 120, () => {})
    assert(!clip.dataset.chatViewportMoving, "Mobile retained the legacy chat motion observer")
    await f.setMobile(false)
    assert(f.surface.parentElement !== document.body && slot.style.height, "Desktop footer owner did not return")
    assert(f.q("textarea") === editor && editor.value === "Breakpoint draft", "Breakpoint changes replaced the editor or draft")
    assert(!document.documentElement.hasAttribute("data-mobile-conversation-open"), "Desktop retained mobile ownership")
    return { editorRetained: true, footerOwnerRestored: true, limits: "Injected media-query change; not a physical rotation." }
})
define("deactivation hides the portal and releases shell ownership without losing draft", async f => {
    await f.open(); flushSync(() => f.story.setDraft("Inactive draft"))
    flushSync(() => f.story.setActive(false)); await frame()
    assert(f.surface.hidden && f.surface.inert, "Inactive portal remained interactive")
    assert(!document.documentElement.hasAttribute("data-mobile-conversation-open"), "Inactive portal kept viewport ownership")
    flushSync(() => f.story.setActive(true))
    await until(() => f.surface.dataset.phase === "open", "Returning portal did not reopen")
    assert(f.q("textarea").value === "Inactive draft", "Deactivation lost draft")
    return await f.geometry()
})
define("repeated pan restoration and reopening do not accumulate frame displacement", async f => {
    for (let i = 0; i < 3; i++) {
        await f.open(); await f.documentPan(396, 396); await f.geometry()
        await f.resetPan(); await f.geometry(); await f.back()
    }
    await f.open()
    const result = await f.geometry()
    near(result.top, 0, "Repeated navigation accumulated an origin")
    return { cycles: 3, ...result }
})

const results = []
for (const item of cases) {
    let f
    try { f = await fixture(); results.push({ name: item.name, passed: true, observations: await item.action(f) }) }
    catch (error) { results.push({ name: item.name, passed: false, error: String(error?.message ?? error) }) }
    finally { await f?.close() }
    document.querySelector("#result").textContent = JSON.stringify({ status: "running", cases: results }, null, 2)
}
const report = { status: "complete", total: cases.length, passed: results.filter(row => row.passed).length, cases: results, userAgent: navigator.userAgent, limits: "Actual surface/footer/motion components and application CSS with injected VisualViewport/media-query values plus real document scrolling. Synthetic draft only; no read hooks, account, provider, native keyboard or physical-device proof." }
window.mobileConversationFixtureResult = report
document.querySelector("#result").textContent = JSON.stringify(report, null, 2)
