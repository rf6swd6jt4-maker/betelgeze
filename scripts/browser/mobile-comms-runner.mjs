import React, { useLayoutEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { ChatMotionViewport } from "./ChatMotionViewport.js"
import { ComposerFooter } from "./ComposerFooter.js"
import { MessageComposer } from "./MessageComposer.js"
import { observeConversationLayout } from "./message-pane-observer.js"
import { observeMobileWorkspaceViewport } from "./mobile-workspace-viewport.js"
import { latestMessageIsVisible } from "./reading-visibility.js"
import { workspaceDocumentIsActive } from "./workspace-tab-activity.js"

const h = React.createElement
const assert = (ok, message) => { if (!ok) throw Error(message) }
const near = (actual, expected, message, tolerance = 1.5) => assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual}, expected ${expected}`)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
const cases = []
const define = (name, action) => cases.push({ name, action })
const tabId = "synthetic-mobile-comms"
const startingRows = Array.from({ length: 40 }, (_, index) => ({ id: `message-${index + 1}`, text: `Synthetic message ${index + 1}` }))

function Chat({ story }) {
    story.renders = (story.renders ?? 0) + 1
    const [text, setText] = useState("")
    const [reply, setReply] = useState(false)
    const [attachment, setAttachment] = useState(false)
    const [active, setActive] = useState(true)
    const [rows, setRows] = useState(startingRows)
    const editorRef = useRef(null)
    const paneRef = useRef(null)
    const followLatest = useRef(true)
    useLayoutEffect(() => {
        Object.assign(story, { setText, setReply, setAttachment, setActive, setRows, editorRef, pane: paneRef.current, followLatest, sends: 0 })
        return observeConversationLayout(paneRef.current, followLatest, () => {})
    }, [story])
    return h("div", { className: "chat" },
        h("header", { className: "chat-header", "data-chat-header": true }, "Synthetic conversation"),
        h(ChatMotionViewport, null,
            h("div", { className: "pane-wrap" },
                h("div", { ref: paneRef, "data-message-pane": true, tabIndex: 0, style: { overflowAnchor: "none" } },
                    h("div", { className: "messages" }, rows.map(row => h("div", { key: row.id, className: "message", "data-message-scroll-anchor": row.id, "data-message-interaction": row.id }, row.text))))),
            h(ComposerFooter, { accessories: h(React.Fragment, null,
                reply ? h("div", { className: "reply", "data-reply-preview": true }, "Replying to synthetic message") : null,
                attachment ? h("div", { className: "attachment", "data-attachment-preview": true }, "Synthetic attachment ready") : null) },
                h(MessageComposer, { active, textareaRef: editorRef, draft: text, onDraftChange: setText, onSend: () => { story.sends++ }, placeholder: "Synthetic message", disabled: false, sendDisabled: false, leadingActions: null, submitLabel: "Send synthetic message" }))))
}

async function fixture() {
    const shell = document.querySelector("#shell")
    const topbar = document.querySelector("[data-workspace-topbar]")
    const tabbar = document.querySelector("[data-workspace-tabbar]")
    const panel = document.querySelector("[data-workspace-tab-panels]")
    const host = document.createElement("div")
    host.id = "chat-host"
    host.dataset.mobileCommsTab = "true"
    panel.append(host)
    const story = {}, rendered = createRoot(host)
    flushSync(() => rendered.render(h(Chat, { story })))
    const viewportDescriptor = Object.getOwnPropertyDescriptor(window, "visualViewport")
    const metrics = Object.assign(new EventTarget(), { height: innerHeight, offsetTop: 0, offsetLeft: 0, width: innerWidth, scale: 1 })
    Object.defineProperty(window, "visualViewport", { configurable: true, value: metrics })
    document.body.dataset.workspaceActiveTabId = tabId
    let active = true
    const owner = observeMobileWorkspaceViewport({ view: window, root: shell, topbar, tabbar, panel, active: () => active })
    const q = selector => host.querySelector(selector)
    const pane = story.pane
    const frames = []
    function sample() {
        const rect = node => node.getBoundingClientRect()
        const chrome = rect(topbar), tabs = rect(tabbar), header = rect(q("[data-chat-header]"))
        const footer = rect(q("footer")), slot = rect(q("[data-composer-slot]")), bounds = rect(pane)
        const last = rect(q("[data-message-interaction]:last-child"))
        const layer = q("[data-chat-motion-layer]")
        const row = { top: metrics.offsetTop, height: metrics.height, chromeTop: chrome.top - metrics.offsetTop, tabsTop: tabs.top - metrics.offsetTop, headerTop: header.top - metrics.offsetTop, footerBottom: footer.bottom - metrics.offsetTop, paneBottom: bounds.bottom - metrics.offsetTop, slotTop: slot.top - metrics.offsetTop, lastBottom: last.bottom - metrics.offsetTop, gap: slot.top - last.bottom, panelHeight: panel.getBoundingClientRect().height, paneHeight: pane.clientHeight, scrollTop: pane.scrollTop, bodyScroll: document.documentElement.scrollTop, transform: getComputedStyle(layer).transform, moving: !!q("[data-chat-motion-viewport]").dataset.chatViewportMoving }
        frames.push(row)
        return row
    }
    function geometry(row = sample(), expectedHeight = metrics.height) {
        near(row.chromeTop, 0, "Top bar moved in the visual viewport")
        near(row.tabsTop, 56, "Tab bar moved in the visual viewport")
        near(row.headerTop, 100, "Conversation header moved in the visual viewport")
        near(row.footerBottom, expectedHeight, "Composer did not meet the visible keyboard edge")
        near(row.slotTop, row.paneBottom, "Message pane and composer separated")
        assert(row.transform === "none" || row.transform === "matrix(1, 0, 0, 1, 0, 0)", `Chat retained a synthetic translation: ${row.transform}`)
        assert(!row.moving, "Chat retained synthetic keyboard motion")
        assert(row.bodyScroll === 0, `Document scroll changed: ${row.bodyScroll}`)
        return row
    }
    async function settle(count = 3, check = true) {
        for (let index = 0; index < count; index++) {
            await frame()
            const row = sample()
            if (check) geometry(row)
        }
    }
    function viewport(values, event = "resize") {
        Object.assign(metrics, values)
        metrics.dispatchEvent(new Event(event))
        const before = performance.now()
        owner.update()
        return performance.now() - before
    }
    const focus = () => q("[data-chat-composer]").focus({ preventScroll: true })
    const mutate = action => flushSync(() => action(story))
    function touch(type) {
        const event = new Event(type, { bubbles: true })
        Object.defineProperty(event, "touches", { value: type === "touchstart" ? [{ clientX: 40, clientY: 240 }] : [] })
        pane.dispatchEvent(event)
    }
    owner.update()
    await settle()
    const initial = sample()
    return {
        shell, topbar, tabbar, panel, host, story, owner, metrics, q, pane, sample, geometry, settle, viewport, focus, mutate, touch, initial, frames,
        setActive(value) { active = value; document.body.dataset.workspaceActiveTabId = value ? tabId : "another-tab"; mutate(story => story.setActive(value)); owner.update() },
        reading() { return workspaceDocumentIsActive(tabId) && latestMessageIsVisible(pane, pane.querySelector("[data-message-interaction]:last-child").dataset.messageInteraction) },
        close() {
            owner.dispose(); flushSync(() => rendered.unmount()); host.remove()
            topbar.style.removeProperty("transform")
            panel.hidden = false
            if (viewportDescriptor) Object.defineProperty(window, "visualViewport", viewportDescriptor)
            else delete window.visualViewport
            delete document.body.dataset.workspaceActiveTabId
        },
    }
}

define("nonzero visual origin and height vary independently without double counting", async f => {
    f.focus()
    for (const values of [{ offsetTop: 120, height: 440 }, { offsetTop: 0, height: 440 }, { offsetTop: 80, height: 470 }, { offsetTop: 150, height: 420 }, { offsetTop: 0, height: innerHeight }]) {
        f.viewport(values)
        f.geometry()
        await f.settle()
        near(f.sample().panelHeight, values.height - 100, "Panel consumed the viewport origin as extra height")
        near(f.sample().gap, f.initial.gap, "Latest message detached from composer")
    }
    return { independentlyVariedOriginAndHeight: true }
})

define("rapid open close reopen never waits for a prior endpoint", async f => {
    f.focus()
    const sequence = [{ height: 540, offsetTop: 0 }, { height: 690, offsetTop: 0 }, { height: 420, offsetTop: 70 }, { height: 620, offsetTop: 40 }, { height: 450, offsetTop: 110 }, { height: 550, offsetTop: 0 }]
    for (const values of sequence) { f.viewport(values); f.geometry(); await f.settle(1) }
    await delay(750)
    f.geometry()
    near(f.sample().footerBottom, 550, "A stale reconciliation replaced the final viewport")
    return { reversals: sequence.length - 1, staleCallbackWindowMs: 750 }
})

define("continuous keyboard accessory and offset-only updates apply directly", async f => {
    f.focus()
    for (const height of [innerHeight - 2, 710, 630, 560, 500, 465]) { f.viewport({ height }); f.geometry(); await f.settle(1) }
    for (const offsetTop of [15, 75, 130, 60, 0]) { f.viewport({ offsetTop }, "scroll"); f.geometry(); await f.settle(1) }
    f.q("[data-chat-composer]").blur()
    await f.settle(3)
    near(f.sample().footerBottom, 465, "Blur manufactured a keyboard dismissal")
    return { continuousSamples: 11 }
})

define("temporary DOM displacement cannot corrupt the viewport origin", async f => {
    f.viewport({ offsetTop: 110, height: 470 })
    await f.settle()
    const top = f.shell.style.getPropertyValue("--mobile-workspace-top")
    // This is deliberately not an iOS keyboard model. An independent visual
    // effect must not enter the viewport owner's stored coordinate arithmetic.
    f.topbar.style.transform = "translateY(-27px)"
    f.owner.update()
    near(f.sample().footerBottom, 470, "Unrelated chrome displacement moved the composer")
    assert(f.shell.style.getPropertyValue("--mobile-workspace-top") === top, "Measured DOM displacement accumulated into the visual origin")
    f.topbar.style.removeProperty("transform")
    f.owner.update()
    await f.settle()
    return { independentDisplacementPx: 27, originUnchanged: true }
})

define("invalid transient metrics and zoom retain the last usable layout", async f => {
    f.viewport({ offsetTop: 40, height: 500 })
    await f.settle()
    const bounds = f.panel.getBoundingClientRect().toJSON()
    for (const values of [{ height: 0 }, { height: NaN }, { height: 500, scale: 1.5 }, { scale: 1, offsetTop: -1 }]) {
        f.viewport(values)
        await frame()
        const current = f.panel.getBoundingClientRect()
        near(current.top, bounds.top, "Invalid viewport moved panel top")
        near(current.height, bounds.height, "Invalid viewport changed panel height")
    }
    f.viewport({ height: 500, offsetTop: 40, scale: 1 })
    await f.settle()
    return { rejectedSamples: 4 }
})

define("multiline reply and attachment growth keep one measured composer", async f => {
    f.viewport({ height: 520, offsetTop: 60 })
    f.focus()
    const heights = []
    for (const text of ["one", "one\ntwo", "one\ntwo\nthree", "one\ntwo\nthree\nfour"]) {
        f.mutate(story => story.setText(text)); await f.settle(4)
        heights.push(f.q("[data-composer-slot]").getBoundingClientRect().height)
        near(f.sample().gap, f.initial.gap, "Draft growth moved latest message away from composer")
    }
    for (let index = 1; index < heights.length; index++) assert(heights[index] >= heights[index - 1] + 15, `Line ${index + 1} did not grow: ${heights}`)
    f.mutate(story => story.setText("one\ntwo\nthree\nfour\nfive\nsix\nseven\neight")); await f.settle(4)
    near(f.q("[data-composer-slot]").getBoundingClientRect().height, heights.at(-1), "Editor grew beyond its four-line cap")
    assert(f.q(".cm-scroller").scrollHeight > f.q(".cm-scroller").clientHeight + 20, "Long editor draft did not scroll internally")
    f.mutate(story => { story.setReply(true); story.setAttachment(true) }); await f.settle(4)
    assert(f.q("[data-composer-slot]").getBoundingClientRect().height > heights.at(-1) + 50, "Previews failed to reserve composer space")
    f.mutate(story => { story.setReply(false); story.setAttachment(false); story.setText("one") }); await f.settle(4)
    near(f.q("[data-composer-slot]").getBoundingClientRect().height, heights[0], "Composer failed to shrink")
    near(f.sample().gap, f.initial.gap, "Preview removal lost the latest message")
    return { lineHeights: heights }
})

define("short landscape viewport keeps the draft and send control accessible", async f => {
    f.mutate(story => {
        story.setText("one\ntwo\nthree\nfour\nfive\nsix")
        story.setReply(true)
        story.setAttachment(true)
    })
    f.q("[data-attachment-preview]").style.minHeight = "180px"
    f.focus()
    const origin = innerHeight < 500 ? 30 : 90
    f.viewport({ offsetTop: origin, height: 320 })
    await f.settle(5)
    const editor = f.q(".cm-scroller"), send = f.q("button[type=submit]")
    for (const [name, node] of [["draft", editor], ["send", send]]) {
        const bounds = node.getBoundingClientRect()
        assert(bounds.top >= origin + 100 + 58 - 1.5 && bounds.bottom <= origin + 320 + 1.5, `${name} escaped short visible chat area: ${JSON.stringify(bounds.toJSON())}`)
        const hit = document.elementFromPoint((bounds.left + bounds.right) / 2, Math.min(bounds.bottom - 2, origin + 318))
        assert(hit && (hit === node || node.contains(hit)), `${name} is clipped or covered in short viewport`)
    }
    const accessories = f.q("[data-composer-accessories]")
    assert(accessories.scrollHeight > accessories.clientHeight + 50, "Oversized attachment tray did not scroll independently")
    accessories.scrollTop = accessories.scrollHeight
    assert(accessories.scrollTop > 0, "Attachment tray cannot reach its overflow content")
    f.geometry()
    return { visualHeight: 320, offsetTop: origin, editorHeight: editor.getBoundingClientRect().height, accessoryScrollHeight: accessories.scrollHeight }
})

define("history keeps an identified row at its bottom-relative reading position", async f => {
    f.story.followLatest.current = false
    f.pane.scrollTop = 410
    await f.settle()
    f.pane.dispatchEvent(new Event("conversation-layout-will-change"))
    const row = [...f.pane.querySelectorAll("[data-message-scroll-anchor]")].find(row => row.getBoundingClientRect().bottom > f.pane.getBoundingClientRect().top)
    const before = row.getBoundingClientRect().top - f.pane.getBoundingClientRect().bottom
    f.viewport({ height: 480, offsetTop: 85 })
    f.mutate(story => story.setText("one\ntwo\nthree\nfour"))
    await f.settle(5)
    near(row.getBoundingClientRect().top - f.pane.getBoundingClientRect().bottom, before, "History anchor shifted relative to visible pane bottom")
    assert(f.pane.scrollHeight - f.pane.clientHeight - f.pane.scrollTop > 100, "History jumped to latest")
    return { anchorId: row.dataset.messageScrollAnchor }
})

define("prepending history and late content sizing preserve the same row", async f => {
    f.story.followLatest.current = false
    f.pane.scrollTop = 340
    await f.settle()
    const row = [...f.pane.querySelectorAll("[data-message-scroll-anchor]")].find(row => row.getBoundingClientRect().bottom > f.pane.getBoundingClientRect().top)
    const before = row.getBoundingClientRect().top
    f.mutate(story => story.setRows(current => [...Array.from({ length: 8 }, (_, index) => ({ id: `older-${index}`, text: `Older synthetic message ${index}` })), ...current]))
    await f.settle(5)
    near(row.getBoundingClientRect().top, before, "Prepending history displaced visible content")
    f.pane.querySelector("[data-message-scroll-anchor]").style.height = "165px"
    await f.settle(5)
    near(row.getBoundingClientRect().top, before, "Late media dimensions displaced visible content")
    return { preservedRow: row.dataset.messageScrollAnchor, prependedRows: 8 }
})

define("touch and momentum own scrolling while geometry follows the keyboard", async f => {
    f.story.followLatest.current = false
    f.pane.scrollTop = 420
    await f.settle()
    const originalScrollTo = f.pane.scrollTo
    let writes = 0
    f.pane.scrollTo = function (...args) { writes++; return originalScrollTo.apply(this, args) }
    try {
        f.touch("touchstart")
        f.pane.scrollTop = 395; f.pane.dispatchEvent(new Event("scroll"))
        f.viewport({ offsetTop: 70, height: 520 })
        await f.settle(2)
        near(f.pane.scrollTop, 395, "Keyboard stole held touch scroll")
        f.touch("touchend")
        for (const [scrollTop, height] of [[370, 510], [350, 490], [338, 475]]) {
            f.pane.scrollTop = scrollTop; f.pane.dispatchEvent(new Event("scroll"))
            f.viewport({ height })
            await f.settle(2)
            near(f.pane.scrollTop, scrollTop, "Keyboard stole native momentum")
        }
        await delay(260)
        near(f.pane.scrollTop, 338, "Settling replayed an old scroll correction")
        assert(writes === 0, `Application wrote scroll ${writes} times during touch/momentum`)
        f.geometry()
        return { applicationScrollWrites: writes }
    } finally { f.pane.scrollTo = originalScrollTo }
})

define("hidden resident tab retains draft editor and returns to current viewport", async f => {
    f.mutate(story => story.setText("Retained local draft"))
    f.focus(); f.viewport({ offsetTop: 80, height: 480 }); await f.settle()
    const editor = f.q("[data-chat-composer]")
    f.setActive(false)
    assert(document.activeElement !== editor, "Inactive composer retained document focus")
    f.panel.hidden = true
    assert(!f.reading(), "Hidden native tab was eligible for reading")
    f.viewport({ offsetTop: 20, height: 560 })
    await delay(80)
    f.panel.hidden = false; f.setActive(true)
    f.pane.dispatchEvent(new Event("conversation-visible"))
    await f.settle(4)
    assert(f.q("[data-chat-composer]") === editor, "Resident editor was remounted")
    assert(editor.textContent === "Retained local draft", "Resident draft was discarded")
    return { retainedEditor: true, retainedDraft: true }
})

define("suspension resumes actual short viewport without manufacturing dismissal", async f => {
    f.viewport({ offsetTop: 90, height: 475 }); f.focus(); await f.settle()
    f.owner.suspend()
    f.panel.hidden = true
    f.viewport({ offsetTop: 30, height: 510 })
    await delay(60)
    f.panel.hidden = false
    f.owner.resume()
    f.pane.dispatchEvent(new Event("conversation-visible"))
    await f.settle(4)
    near(f.sample().footerBottom, 510, "Resume invented full-height geometry")
    return { resumedVisibleHeight: 510 }
})

define("selection survives nonzero-origin keyboard and composer transitions", async f => {
    f.mutate(story => story.setText("one two three four")); f.focus(); await f.settle()
    const text = f.q(".cm-line").firstChild
    const range = document.createRange(); range.setStart(text, 4); range.setEnd(text, 13)
    const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range)
    const selected = selection.toString()
    for (const values of [{ offsetTop: 80, height: 490 }, { offsetTop: 20, height: 570 }, { offsetTop: 110, height: 470 }]) {
        f.viewport(values); await f.settle(2)
        assert(selection.toString() === selected, "Viewport update destroyed the native selection")
    }
    return { preservedSelectionLength: selected.length }
})

define("latest row eligibility rejects occlusion history and wrong native identity", async f => {
    f.viewport({ offsetTop: 65, height: 480 }); await f.settle(4)
    assert(f.reading(), "Visible positioned latest row should remain eligible")
    document.body.dataset.workspaceActiveTabId = "another-tab"
    assert(!f.reading(), "Wrong native tab identity created read eligibility")
    document.body.dataset.workspaceActiveTabId = tabId
    const cover = document.createElement("div")
    cover.style.cssText = "position:fixed;inset:0;z-index:9999;background:#000"
    document.body.append(cover)
    assert(!f.reading(), "Covered latest row created read eligibility")
    cover.remove()
    f.story.followLatest.current = false; f.pane.scrollTop = 100
    await f.settle(2)
    assert(!f.reading(), "Scrolled history created latest-row read eligibility")
    return { rejectedStates: ["wrong-native-tab", "overlay", "scrolled-history"] }
})

define("keyboard-clipped newest row cannot satisfy reading visibility", async f => {
    f.viewport({ offsetTop: 0, height: 500 }); await f.settle(4)
    assert(f.reading(), "Control latest row should be visible")
    // Hold geometry constant while the browser reports a smaller visible area.
    // This simulates the event-delivery gap without asking the layout owner to
    // fabricate a stale endpoint. The unchanged reader must reject the row.
    f.metrics.height = f.q("[data-message-interaction]:last-child").getBoundingClientRect().bottom - 30
    assert(!f.reading(), "A row clipped by the keyboard was accepted as visible")
    f.owner.update(); await f.settle(4)
    assert(f.reading(), "Corrected visible latest row never became eligible again")
    return { rejectedUnreconciledViewport: true }
})

define("send control retains focus and respects IME composition", async f => {
    f.mutate(story => story.setText("Synthetic send draft")); f.focus(); await f.settle()
    const editor = f.q("[data-chat-composer]"), send = f.q("button[type=submit]")
    const pointer = new PointerEvent("pointerdown", { pointerId: 1, pointerType: "touch", bubbles: true, cancelable: true, isPrimary: true })
    send.dispatchEvent(pointer)
    assert(pointer.defaultPrevented, "Send pointerdown did not preserve editor focus")
    assert(document.activeElement === editor, "Send control stole editor focus")
    editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "x" }))
    send.click()
    assert(f.story.sends === 0, "Send committed unfinished IME composition")
    editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "x" }))
    await delay(30)
    send.click()
    assert(f.story.sends === 1, `Finished composition sent ${f.story.sends} times`)
    return { syntheticSends: f.story.sends, focusPreserved: true }
})

define("continuous geometry stays bounded with recent and loaded history windows", async f => {
    const samples = []
    for (const count of [60, 300]) {
        f.mutate(story => {
            story.setRows(Array.from({ length: count }, (_, index) => ({ id: `window-${index}`, text: `Loaded synthetic message ${index}` })))
            story.setText("Stable draft while keyboard moves")
        })
        await f.settle(4)
        const editor = f.q("[data-chat-composer]"), row = f.q("[data-message-interaction]:last-child"), renders = f.story.renders
        const durations = []
        for (let index = 0; index < 60; index++) {
            durations.push(f.viewport({ offsetTop: index % 3 === 0 ? 85 : 0, height: 500 + Math.round(60 * Math.sin(index / 8)) }))
            f.geometry()
            await frame()
            assert(f.q("[data-chat-composer]") === editor && f.q("[data-message-interaction]:last-child") === row, "Viewport update recreated resident content")
        }
        assert(f.story.renders === renders, `Viewport movement caused ${f.story.renders - renders} React chat renders`)
        assert(editor.textContent === "Stable draft while keyboard moves", "Viewport movement corrupted draft")
        durations.sort((a, b) => a - b)
        samples.push({ loadedMessages: count, samples: durations.length, medianUpdateMs: durations[29], p95UpdateMs: durations[56], maxUpdateMs: durations.at(-1), reactRenders: 0, editorReplacements: 0 })
    }
    return { observations: samples, limits: "Synthetic synchronous owner timing; not authenticated production latency or physical-device performance." }
})

const selectedCases = new URL(location.href).searchParams.has("landscape") ? cases.filter(row => row.name.startsWith("short landscape")) : cases
const results = []
for (const item of selectedCases) {
    let f
    try {
        f = await fixture()
        const observations = await item.action(f)
        results.push({ name: item.name, passed: true, observations, frameCount: f.frames.length })
    } catch (error) {
        results.push({ name: item.name, passed: false, error: String(error?.message ?? error), samples: f?.frames.slice(-4) })
    } finally { f?.close() }
    document.querySelector("#result").textContent = JSON.stringify({ status: "running", cases: results }, null, 2)
}
const report = { status: "complete", total: selectedCases.length, passed: results.filter(row => row.passed).length, cases: results, userAgent: navigator.userAgent, limits: "Synthetic Chromium/WebKit viewport events and gestures with production geometry CSS/owner/editor/footer/scroll observer/reading predicates. Not a physical keyboard, native momentum, authenticated UI, read persistence, or provider-delivery check." }
window.mobileCommsFixtureResult = report
document.querySelector("#result").textContent = JSON.stringify(report, null, 2)
