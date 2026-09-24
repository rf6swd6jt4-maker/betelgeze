import React, { useLayoutEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { EditorView } from "@codemirror/view"
import { undo, redo, undoDepth, redoDepth } from "@codemirror/commands"
import { ChatMotionViewport } from "./ChatMotionViewport.js"
import { ComposerFooter } from "./ComposerFooter.js"
import { ChatComposerInput } from "./ChatComposerInput.js"
import { observeConversationLayout } from "./message-pane-observer.js"
import { createComposerViewportController, COMPOSER_KEYBOARD_MOTION_MS } from "./composer-viewport-controller.js"
import { createViewportOriginRecovery } from "./viewport-origin-recovery.js"
import { createWorkspaceVisualOrigin } from "./workspace-visual-origin.js"
import { readChatLayoutBottom, readChatViewportBottom } from "./chat-viewport-state.js"
import { requestChatViewportMotion } from "./chat-viewport-motion.js"
import { WORKSPACE_TAB_VISIBILITY_EVENT } from "./workspace-tabs.js"

const h = React.createElement
const baseline = FIXTURE_BASELINE
const delay = ms => new Promise(done => setTimeout(done, ms))
const assert = (ok, message) => { if (!ok) throw Error(message) }
const rows = Array.from({ length: 34 }, (_, index) => `Synthetic message ${index + 1}`)

function Chat({ story }) {
    const [text, setText] = useState("")
    const [reply, setReply] = useState(false)
    const [attachment, setAttachment] = useState(false)
    const [active, setActive] = useState(true)
    const [disabled, setDisabled] = useState(false)
    const editorRef = useRef(null)
    const paneRef = useRef(null)
    const followLatest = useRef(true)
    useLayoutEffect(() => {
        story.setText = setText
        story.setReply = setReply
        story.setAttachment = setAttachment
        story.setActive = setActive
        story.setDisabled = setDisabled
        story.editorRef = editorRef
        story.pane = paneRef.current
        story.followLatest = followLatest
        const stop = observeConversationLayout(paneRef.current, followLatest, () => {})
        return stop
    }, [story])
    return h("div", { className: "chat" },
        h("header", { className: "chat-header", "data-chat-header": true }, "Synthetic conversation"),
        h(ChatMotionViewport, null,
            h("div", { className: "pane-wrap" },
                h("div", { ref: paneRef, "data-message-pane": true, tabIndex: 0, style: { overflowAnchor: "none" } },
                    h("div", { className: "messages" }, rows.map((row, index) => h("div", { key: index, className: "message", "data-message-scroll-anchor": true, "data-last-message": index === rows.length - 1 ? "true" : undefined }, row))))),
            h(ComposerFooter, null,
                reply ? h("div", { className: "reply", "data-reply-preview": true }, "Replying to synthetic message") : null,
                attachment ? h("div", { className: "attachment", "data-attachment-preview": true }, "Synthetic attachment ready") : null,
                h("form", { className: "form", onSubmit: event => event.preventDefault() },
                    h(ChatComposerInput, { inputRef: editorRef, value: text, onChange: setText, onSend: () => {}, onFocus: () => story.onFocus?.(), onBlur: () => story.onBlur?.(), active, disabled, placeholder: "Synthetic message" }),
                    h("button", { type: "submit", "aria-label": "Send synthetic message" }, "↑")))))
}

function mountChat(container) {
    const root = createRoot(container)
    const story = {}
    flushSync(() => root.render(h(Chat, { story })))
    return {
        story,
        setText(value) { flushSync(() => story.setText(value)) },
        setReply(value) { flushSync(() => story.setReply(value)) },
        setAttachment(value) { flushSync(() => story.setAttachment(value)) },
        setActive(value) { flushSync(() => story.setActive(value)) },
        setDisabled(value) { flushSync(() => story.setDisabled(value)) },
        close() { flushSync(() => root.unmount()) },
    }
}

if (location.pathname === "/frame") {
    window.commsMount = () => mountChat(document.querySelector("#chat-host"))
} else {
    const desktop = new URL(location.href).searchParams.has("desktop")
    const reduced = new URL(location.href).searchParams.has("reduced")
    const cases = []
    const define = (name, action) => cases.push({ name, action })
    const layout = readChatLayoutBottom(window)

    async function fixture(mode) {
        const shell = document.querySelector("#shell")
        const panel = document.querySelector("[data-workspace-tab-panels]")
        let frame = null, mount
        if (mode === "resident-iframe") {
            frame = document.createElement("iframe")
            frame.id = "chat-frame"
            frame.src = "/frame"
            panel.append(frame)
            await new Promise((done, fail) => { frame.onload = done; frame.onerror = fail })
            mount = frame.contentWindow.commsMount()
        } else {
            const host = document.createElement("div")
            host.id = "chat-host"
            panel.append(host)
            mount = mountChat(host)
        }
        const view = frame?.contentWindow ?? window
        const doc = view.document
        let measured = layout
        let applied = layout
        const trace = [], motionCaptures = [], measuredFrames = []
        const fakeView = () => ({ document, innerHeight: window.innerHeight, visualViewport: { height: measured, offsetTop: 0, scale: 1 } })
        const apply = bottom => { applied = bottom; shell.style.setProperty("--bottom", `${bottom}px`) }
        const visualOrigin = createWorkspaceVisualOrigin({
            readTop: () => document.querySelector("[data-workspace-topbar]").getBoundingClientRect().top,
            readLimit: () => matchMedia("(max-width: 1023px)").matches ? layout / 2 : 0,
            writeOffset: offset => shell.style.setProperty("--origin", `${offset}px`),
            requestFrame: callback => requestAnimationFrame(callback),
            cancelFrame: id => cancelAnimationFrame(id),
        })
        const controller = createComposerViewportController({
            readBottom: () => readChatViewportBottom(fakeView()),
            readLayoutBottom: () => readChatLayoutBottom(window),
            readAppliedBottom: () => applied,
            writeBottom: (bottom, animate) => {
                if (!baseline) visualOrigin.update()
                motionCaptures.push({ top: document.querySelector("[data-workspace-topbar]").getBoundingClientRect().top, target: bottom, animate })
                requestChatViewportMotion(panel, applied, bottom, animate ? COMPOSER_KEYBOARD_MOTION_MS : 0, apply)
            },
            animateKeyboard: () => matchMedia("(max-width: 1023px)").matches,
            schedule: (callback, delayMs) => setTimeout(callback, delayMs),
            cancel: timer => clearTimeout(timer),
            diagnose: sample => trace.push(sample),
        })
        const origin = createViewportOriginRecovery({
            canRestore: () => measured >= layout - 1,
            restore: () => { shell.scrollTop = 0 },
            requestFrame: callback => requestAnimationFrame(callback),
            cancelFrame: id => cancelAnimationFrame(id),
        })
        let focusEvents = 0, blurEvents = 0
        mount.story.onFocus = () => { focusEvents++; if (!baseline) visualOrigin.update(); origin.focus(); controller.focus() }
        mount.story.onBlur = () => { blurEvents++; if (!baseline) visualOrigin.update(); origin.blur(); controller.blur() }
        const q = selector => doc.querySelector(selector)
        const rect = selector => q(selector)?.getBoundingClientRect()
        const hostY = () => frame?.getBoundingClientRect().top ?? 0
        function sample() {
            const footer = rect("footer"), slot = rect("[data-composer-slot]"), last = rect("[data-last-message]"), header = rect("[data-chat-header]")
            assert(footer && last && header, "Mounted production chat geometry missing")
            const shift = hostY()
            const topbar = document.querySelector("[data-workspace-topbar]").getBoundingClientRect()
            const tabbar = document.querySelector("[data-workspace-tabbar]").getBoundingClientRect()
            const pane = mount.story.pane, lastNode = q("[data-last-message]")
            const paneWrap = q(".pane-wrap"), slotNode = q("[data-composer-slot]")
            assert(lastNode.offsetParent === paneWrap, "Last message lost positioned pane coordinate owner")
            assert(slotNode.offsetParent === paneWrap.offsetParent, "Composer slot lost shared layout coordinate owner")
            assert(Math.abs(paneWrap.offsetHeight - pane.clientHeight) <= 1, "Pane wrapper and scrollport heights diverged")
            // Both nodes share the animated layer. WebKit can advance that
            // compositor transform between separate getBoundingClientRect reads.
            // Local content coordinates preserve the actually painted gap.
            const adjacency = slotNode.offsetTop - (paneWrap.offsetTop + paneWrap.offsetHeight)
            const gap = adjacency + pane.clientHeight + pane.scrollTop - (lastNode.offsetTop + lastNode.offsetHeight)
            return { at: performance.now(), topbarTop: topbar.top, tabbarTop: tabbar.top, headerTop: header.top + shift, footerBottom: footer.bottom + shift, lastBottom: last.bottom + shift, gap, adjacency, rawRectGap: slot.top - last.bottom, paneTop: pane.scrollTop, paneHeight: pane.clientHeight, target: measured, applied, moving: !!q("[data-chat-motion-viewport]")?.dataset.chatViewportMoving }
        }
        async function frames(ms = 350) {
            const output = [], until = performance.now() + ms
            while (performance.now() < until) {
                await new Promise(done => requestAnimationFrame(() => setTimeout(done, 0)))
                const row = sample()
                output.push(row)
                measuredFrames.push(row)
            }
            return output
        }
        const initial = sample()
        const focus = () => { const before = focusEvents, editor = q("[data-chat-composer]"); editor?.focus({ preventScroll: true }); assert(doc.activeElement === editor, "Production editor did not focus"); if (before === 0) assert(focusEvents > before, "Production composer focus callback did not fire") }
        const blur = () => { const before = blurEvents; q("[data-chat-composer]")?.blur(); assert(blurEvents > before, "Production composer blur callback did not fire") }
        const move = bottom => { measured = bottom; if (baseline) { controller.update(); origin.update(); visualOrigin.update() } else { visualOrigin.update(); origin.update(); controller.update() } }
        const checkChrome = list => { for (const row of list) assert(Math.abs(row.topbarTop) <= 2 && Math.abs(row.tabbarTop - 56) <= 2 && Math.abs(row.headerTop - 100) <= 2, `Chrome displaced: ${JSON.stringify(row)}`) }
        const checkGap = (list, tolerance = 2) => { for (const row of list) { assert(Math.abs(row.adjacency) <= 2, `Composer slot separated from message pane: ${JSON.stringify(row)}`); assert(Math.abs(row.gap - initial.gap) <= tolerance, `Message/composer gap changed: ${JSON.stringify(row)}`) } }
        const checkEnd = (bottom, tolerance = 3) => { const row = sample(); assert(Math.abs(row.footerBottom - bottom) <= tolerance, `Composer ended at ${row.footerBottom}, target ${bottom}`); assert(!q("[data-chat-motion-viewport]")?.dataset.chatViewportMoving, "Motion remained marked active") }
        const checkMonotonic = (list, from, to, tolerance = 2) => {
            const direction = Math.sign(to - from)
            let previous = from
            for (const row of list) {
                assert(row.footerBottom >= Math.min(from, to) - tolerance && row.footerBottom <= Math.max(from, to) + tolerance, `Composer left motion bounds: ${JSON.stringify(row)}`)
                assert(direction * (row.footerBottom - previous) >= -tolerance, `Composer reversed with unchanged target: ${JSON.stringify({ previous, row })}`)
                previous = row.footerBottom
            }
        }
        function close() {
            origin.dispose(); visualOrigin.dispose(); controller.dispose(); mount.close()
            frame?.remove()
            if (!frame) panel.querySelector("#chat-host")?.remove()
            shell.style.removeProperty("--bottom")
            shell.style.removeProperty("--origin")
            shell.style.removeProperty("--pan")
        }
        await delay(40)
        return { mode, shell, panel, doc, q, rect, view, mount, controller, origin, visualOrigin, trace, motionCaptures, measuredFrames, sample, frames, focus, blur, move, checkChrome, checkGap, checkEnd, checkMonotonic, close, initial, layout }
    }

    // These tests exercise event order in the actual CodeMirror composer.
    // Synthetic pointers do not reproduce a native mobile keyboard or prove
    // that the OS compositor paints keyboard transitions without displacement.
    for (const mode of ["native", "resident-iframe"]) {
        function watchFocus(f) {
            const editor = f.q("[data-chat-composer]"), calls = []
            const nativeFocus = f.view.HTMLElement.prototype.focus
            editor.focus = options => { calls.push(options); nativeFocus.call(editor, options) }
            const pointer = type => editor.dispatchEvent(new f.view.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX: 20, clientY: 20 }))
            return { editor, calls, nativeFocus, pointer }
        }
        define(`${mode}: mobile surface keeps native activation before prevent-scroll reassertion`, async f => {
            f.q(".chat").setAttribute("data-mobile-conversation-surface", "")
            const { editor, calls, nativeFocus, pointer } = watchFocus(f)
            assert(pointer("pointerdown") && pointer("pointerup"), "Composer cancelled native pointer activation")
            assert(calls.length === 0 && f.doc.activeElement !== editor, "Pointer release forced focus before native activation")
            let observedDuringFocus = 0
            const afterFocus = () => { observedDuringFocus = calls.length }
            editor.addEventListener("focusin", afterFocus)
            nativeFocus.call(editor)
            editor.removeEventListener("focusin", afterFocus)
            assert(f.doc.activeElement === editor, "Native activation did not focus the editor")
            assert(calls.length === 1 && calls[0]?.preventScroll === true && observedDuringFocus === 1, "Prevent-scroll reassertion was missing or deferred beyond focusin")
            calls.length = 0
            assert(pointer("pointerdown") && pointer("pointerup"), "Focused composer cancelled pointer events")
            assert(calls.length === 0, "Focused touch release forced focus")
            const click = new f.view.MouseEvent("click", { bubbles: true, cancelable: true })
            editor.dispatchEvent(click)
            assert(!click.defaultPrevented && calls.length === 1 && calls[0]?.preventScroll === true, "Already focused click did not synchronously retain prevent-scroll focus")
            return { focusinSynchronous: true, clickWithoutFocusin: true, pointerFocusCalls: 0 }
        })
        define(`${mode}: native focus retention preserves editor, selection and undo history`, async f => {
            f.q(".chat").setAttribute("data-mobile-conversation-surface", "")
            f.mount.setText("one two three")
            const editor = f.q("[data-chat-composer]"), view = EditorView.findFromDOM(editor)
            assert(view, "Actual CodeMirror view was not available")
            view.dispatch({ changes: { from: view.state.doc.length, insert: "!" }, userEvent: "input.type" })
            await delay(30)
            f.focus()
            view.dispatch({ selection: { anchor: 4, head: 7 } })
            await delay(30)
            const selection = f.doc.getSelection(), beforeRange = selection.getRangeAt(0).cloneRange()
            const before = { doc: view.state.doc, selection: view.state.selection, undo: undoDepth(view.state), redo: redoDepth(view.state), top: view.scrollDOM.scrollTop }
            assert(before.undo > 0 && selection.toString() === "two", "Fixture did not establish undo history and native selection")
            for (const type of ["focusin", "click", "click"]) editor.dispatchEvent(new f.view.Event(type, { bubbles: true, cancelable: true }))
            const afterRange = selection.getRangeAt(0)
            assert(f.q("[data-chat-composer]") === editor && EditorView.findFromDOM(editor) === view, "Focus retention replaced the editor")
            assert(view.state.doc === before.doc && view.state.selection.eq(before.selection), "Focus retention changed CodeMirror content or selection")
            assert(selection.toString() === "two" && beforeRange.startContainer === afterRange.startContainer && beforeRange.startOffset === afterRange.startOffset && beforeRange.endContainer === afterRange.endContainer && beforeRange.endOffset === afterRange.endOffset, "Focus retention replaced or moved the native selection")
            assert(undoDepth(view.state) === before.undo && redoDepth(view.state) === before.redo && view.scrollDOM.scrollTop === before.top, "Focus retention changed undo history or scroller position")
            assert(undo(view) && view.state.doc.toString() === "one two three", "Editing undo stopped working after native focus retention")
            assert(redo(view) && view.state.doc.toString() === "one two three!", "Editing redo stopped working after native focus retention")
            return { sameEditor: true, nativeSelection: "two", undoRedo: true }
        })
        define(`${mode}: inactive disabled hidden and inert surfaces do not reassert focus`, async f => {
            const chat = f.q(".chat")
            chat.setAttribute("data-mobile-conversation-surface", "")
            const { editor, calls, nativeFocus, pointer } = watchFocus(f)
            nativeFocus.call(editor)
            const excluded = () => {
                calls.length = 0
                editor.dispatchEvent(new f.view.Event("focusin", { bubbles: true }))
                editor.dispatchEvent(new f.view.MouseEvent("click", { bubbles: true }))
                assert(calls.length === 0, "Excluded composer reasserted focus")
            }
            f.mount.setDisabled(true); excluded()
            pointer("pointerdown"); pointer("pointerup")
            assert(calls.length === 0, "Disabled composer forced pointer focus")
            f.mount.setDisabled(false)
            chat.inert = true; excluded(); chat.inert = false
            chat.hidden = true; excluded(); chat.hidden = false
            f.mount.setActive(false); excluded()
            pointer("pointerdown"); pointer("pointerup")
            assert(calls.length === 0, "Inactive composer forced pointer focus")
            f.mount.setActive(true); nativeFocus.call(editor)
            calls.length = 0
            editor.dispatchEvent(new f.view.MouseEvent("click", { bubbles: true }))
            assert(calls.length === 1 && calls[0]?.preventScroll === true, "Reactivated surface did not resume native focus retention")
            return { disabled: true, inactive: true, hidden: true, inert: true, resumes: true }
        })
        define(`${mode}: composers outside mobile surfaces retain legacy activation`, async f => {
            const { editor, calls, pointer } = watchFocus(f)
            assert(!editor.closest("[data-mobile-conversation-surface]"), "Legacy test accidentally opted into mobile surface")
            pointer("pointerdown")
            assert(calls.length === 0, "Legacy touch focused before release")
            pointer("pointerup")
            assert(calls.length === 1 && calls[0]?.preventScroll === true, "Legacy touch no longer focuses on release")
            calls.length = 0
            editor.dispatchEvent(new f.view.MouseEvent("click", { bubbles: true }))
            assert(calls.length === 0, "Legacy click unexpectedly reasserted focus")
            editor.dispatchEvent(new f.view.PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", isPrimary: true, button: 0 }))
            assert(calls.length === 1 && calls[0]?.preventScroll === true, "Legacy mouse no longer focuses on contact")
            return { touchRelease: true, mouseContact: true, extraClickFocus: false }
        })
    }

    if (desktop) {
        define("desktop: valid resize follows measured edge immediately", async f => {
            f.focus(); f.move(f.layout - 230)
            const measured = await f.frames(100)
            f.checkChrome(measured); f.checkGap(measured)
            assert(measured.every(row => Math.abs(row.footerBottom - (f.layout - 230)) < 3), "Desktop composer did not follow valid viewport measurement immediately")
            assert(measured.every(row => row.applied === f.layout - 230), "Desktop resize ran a synthetic motion")
            return { frames: measured.length }
        })
    } else if (reduced) {
        for (const mode of ["native", "resident-iframe"]) define(`${mode}: reduced motion commits measured edge without animation`, async f => {
            f.focus(); f.move(f.layout - 300)
            const samples = await f.frames(80)
            f.checkChrome(samples); f.checkGap(samples); f.checkEnd(f.layout - 300)
            assert(samples.every(row => Math.abs(row.footerBottom - (f.layout - 300)) <= 2), "Reduced motion showed an intermediate keyboard animation")
            return { frames: samples.length }
        })
    } else {
        for (const mode of ["native", "resident-iframe"]) {
            define(`${mode}: keyboard open and close stays in bounds`, async f => {
                const start = f.sample().footerBottom
                f.focus(); f.move(f.layout - 300)
                const opening = await f.frames(390)
                f.checkChrome(opening); f.checkGap(opening); f.checkMonotonic(opening, start, f.layout - 300); f.checkEnd(f.layout - 300)
                f.blur(); f.move(f.layout)
                const closing = await f.frames(390)
                f.checkChrome(closing); f.checkGap(closing); f.checkMonotonic(closing, f.layout - 300, f.layout); f.checkEnd(f.layout)
                return { openingFrames: opening.length, closingFrames: closing.length }
            })
            define(`${mode}: continuous viewport samples remain coordinated`, async f => {
                f.focus()
                const all = []
                for (const bottom of [f.layout - 2, f.layout - 90, f.layout - 150, f.layout - 230, f.layout - 310]) {
                    f.move(bottom)
                    const sample = f.sample()
                    assert(Math.abs(sample.footerBottom - bottom) <= 2 && sample.applied === bottom, `Continuous viewport sample did not commit immediately: ${JSON.stringify(sample)}`)
                    all.push(...await f.frames(75))
                }
                f.checkChrome(all); f.checkGap(all); f.checkMonotonic(all, f.layout, f.layout - 310); f.checkEnd(f.layout - 310)
                assert(!all.some(row => row.moving), "Continuous samples started a synthetic animation")
                return { frames: all.length }
            })
            define(`${mode}: rapid close and reopen follows new focus`, async f => {
                f.focus(); f.move(f.layout - 300); await f.frames(340)
                f.blur(); f.move(f.layout - 130); await f.frames(50)
                f.focus(); f.move(f.layout - 330)
                const samples = await f.frames(390)
                f.checkChrome(samples); f.checkGap(samples); f.checkEnd(f.layout - 330)
                assert(Math.max(...samples.map(row => row.footerBottom)) < f.layout - 80, "Old resting endpoint flashed during reopen")
                return { frames: samples.length }
            })
            define(`${mode}: blur while viewport remains short does not jump`, async f => {
                f.focus(); f.move(f.layout - 300); await f.frames(350)
                f.blur()
                const samples = await f.frames(390)
                f.checkChrome(samples); f.checkGap(samples)
                assert(samples.every(row => row.footerBottom <= f.layout - 285), "Blur invented a resting endpoint while measured viewport stayed short")
                f.move(f.layout); await f.frames(350); f.checkEnd(f.layout)
                return { frames: samples.length }
            })
            define(`${mode}: resume while viewport remains short uses measured edge`, async f => {
                f.focus(); f.move(f.layout - 300); await f.frames(350)
                f.controller.suspend(); f.origin.suspend()
                f.panel.hidden = true
                await delay(30)
                f.panel.hidden = false
                f.visualOrigin.resume(); f.origin.resume(); f.controller.resume()
                f.mount.story.pane.dispatchEvent(new Event("conversation-visible"))
                f.move(f.layout - 300)
                const samples = await f.frames(390)
                f.checkChrome(samples); f.checkGap(samples); f.checkEnd(f.layout - 300)
                return { frames: samples.length }
            })
            define(`${mode}: four-line draft, reply and attachment keep geometry`, async f => {
                f.focus(); f.move(f.layout - 300)
                const samples = []
                const slotHeight = () => f.rect("[data-composer-slot]").height
                const heights = []
                for (const text of ["one", "one\ntwo", "one\ntwo\nthree", "one\ntwo\nthree\nfour"]) {
                    f.mount.setText(text)
                    samples.push(...await f.frames(210))
                    heights.push(slotHeight())
                }
                for (let index = 1; index < heights.length; index++) assert(heights[index] >= heights[index - 1] + 15, `Composer slot did not grow for line ${index + 1}: ${JSON.stringify(heights)}`)
                f.mount.setText("one\ntwo\nthree\nfour\nfive\nsix\nseven\neight")
                samples.push(...await f.frames(210))
                const cappedHeight = slotHeight(), scroller = f.q(".cm-scroller")
                assert(Math.abs(cappedHeight - heights.at(-1)) <= 2, `Four-line mobile cap failed: ${JSON.stringify({ heights, cappedHeight })}`)
                assert(scroller.scrollHeight > scroller.clientHeight + 20, "Over-limit draft did not scroll internally")
                f.mount.setText("one")
                samples.push(...await f.frames(210))
                const shrunkHeight = slotHeight()
                assert(Math.abs(shrunkHeight - heights[0]) <= 2, `Composer slot did not shrink to one line: ${JSON.stringify({ heights, shrunkHeight })}`)
                f.mount.setReply(true); samples.push(...await f.frames(210))
                const replyHeight = slotHeight()
                assert(replyHeight >= shrunkHeight + 20, "Reply preview did not expand composer slot")
                f.mount.setAttachment(true); samples.push(...await f.frames(210))
                const attachmentHeight = slotHeight()
                assert(attachmentHeight >= replyHeight + 20, "Attachment preview did not expand composer slot")
                f.mount.setReply(false); f.mount.setAttachment(false); samples.push(...await f.frames(250))
                f.checkChrome(samples); f.checkGap(samples); f.checkEnd(f.layout - 300)
                return { frames: samples.length, heights, cappedHeight, shrunkHeight, replyHeight, attachmentHeight }
            })
            define(`${mode}: scrolled history retains its anchor through composer growth`, async f => {
                const pane = f.mount.story.pane
                f.mount.story.followLatest.current = false
                pane.scrollTop = 280
                await f.frames(70)
                pane.dispatchEvent(new Event("conversation-layout-will-change"))
                const visible = [...pane.querySelectorAll("[data-message-scroll-anchor]")].find(row => row.getBoundingClientRect().bottom > pane.getBoundingClientRect().top)
                const beforeScrollTop = pane.scrollTop
                const beforeHeight = pane.clientHeight
                f.focus(); f.move(f.layout - 290)
                f.mount.setText("one\ntwo\nthree\nfour")
                const samples = await f.frames(390)
                const afterScrollTop = pane.scrollTop
                f.checkChrome(samples)
                const expectedShift = pane.clientHeight - beforeHeight
                const actualShift = beforeScrollTop - afterScrollTop
                assert(visible.isConnected, "History anchor was replaced")
                assert(Math.abs(actualShift - expectedShift) <= 2, `Scrolled history anchor shifted ${actualShift}px; expected pane-height shift ${expectedShift}px`)
                assert(pane.scrollHeight - pane.clientHeight - pane.scrollTop > 24, "History unexpectedly jumped to latest")
                return { anchorDelta: Math.round(actualShift), expectedShift, frames: samples.length }
            })
            define(`${mode}: scrolled history accessory removal compensates a native scroll clamp only once`, async f => {
                // The mobile surface uses natural footer flex sizing; the
                // legacy footer's height tween would hide this one-step clamp.
                const chat = f.q(".chat")
                chat.dataset.mobileConversationSurface = "true"
                chat.dataset.phase = "open"
                f.view.dispatchEvent(new f.view.Event("betelgeze:mobile-conversation-visibility"))
                f.mount.setReply(true)
                await f.frames(230)
                const pane = f.mount.story.pane
                assert(!f.q("[data-composer-slot]").style.height && !f.q("[data-composer-slot]").style.transition,
                    "Accessory clamp fixture did not switch to natural mobile footer sizing")
                const gapFromLatest = 12
                f.mount.story.followLatest.current = false
                pane.scrollTop = pane.scrollHeight - pane.clientHeight - gapFromLatest
                await f.frames(70)
                pane.dispatchEvent(new Event("conversation-layout-will-change"))
                const anchor = [...pane.querySelectorAll("[data-message-scroll-anchor]")]
                    .find(row => row.getBoundingClientRect().bottom > pane.getBoundingClientRect().top + 10)
                assert(anchor, "Accessory clamp fixture has no visible history anchor")
                const before = { top: pane.scrollTop, height: pane.clientHeight,
                    anchorGap: pane.getBoundingClientRect().bottom - anchor.getBoundingClientRect().bottom }
                const nativeScrollTo = pane.scrollTo.bind(pane), writes = []
                pane.scrollTo = (...args) => {
                    writes.push({ before: pane.scrollTop, target: args[0]?.top ?? args[1], height: pane.clientHeight })
                    return nativeScrollTo(...args)
                }
                let samples
                try { f.mount.setReply(false); samples = await f.frames(230) }
                finally { pane.scrollTo = nativeScrollTo }
                const expansion = pane.clientHeight - before.height
                const expectedTop = before.top - expansion
                assert(expansion > gapFromLatest + 10, "Accessory removal did not expand the pane enough to force native clamping")
                const naturalMax = pane.scrollHeight - pane.clientHeight
                assert(writes.some(write => write.height === pane.clientHeight && Math.abs(write.before - naturalMax) <= 1
                    && write.before < before.top && write.before > write.target + 1),
                    `Fixture did not observe browser clamping before observer correction: ${JSON.stringify(writes)}`)
                assert(Math.abs(pane.scrollTop - expectedTop) <= 2,
                    `Accessory removal compensated native clamp twice: scroll ${pane.scrollTop}, expected ${expectedTop}, expansion ${expansion}`)
                assert(Math.abs((pane.scrollHeight - pane.clientHeight - pane.scrollTop) - gapFromLatest) <= 2,
                    "Accessory removal changed the distance from latest while follow-latest was disabled")
                const anchorGap = pane.getBoundingClientRect().bottom - anchor.getBoundingClientRect().bottom
                assert(anchor.isConnected && Math.abs(anchorGap - before.anchorGap) <= 2,
                    `Accessory removal displaced the bounded history anchor: ${anchorGap}, expected ${before.anchorGap}`)
                assert(!f.mount.story.followLatest.current, "Accessory removal changed the history follow preference")
                f.checkChrome(samples)
                return { expansion, beforeTop: before.top, finalTop: pane.scrollTop, expectedTop, anchorGap, writes }
            })
            define(`${mode}: revised keyboard sample waits for held history touch`, async f => {
                const pane = f.mount.story.pane
                const touch = type => {
                    const event = new Event(type, { bubbles: true })
                    Object.defineProperty(event, "touches", { value: type === "touchstart" ? [{ clientX: 10, clientY: 200 }] : [] })
                    pane.dispatchEvent(event)
                }
                f.focus(); f.move(f.layout - 300)
                touch("touchstart")
                await f.frames(350)
                assert(f.sample().applied === f.layout, "Active touch committed first motion into host layout")
                f.move(f.layout - 320)
                await f.frames(80)
                assert(f.sample().applied === f.layout, "Revised sample resized host during active touch")
                touch("touchend")
                pane.dispatchEvent(new Event("scroll", { bubbles: true }))
                f.move(f.layout - 325)
                await f.frames(80)
                assert(f.sample().applied === f.layout, "Revised sample resized host during synthetic momentum")
                await f.frames(320)
                f.checkEnd(f.layout - 325)
                return { deferredUntilTouchAndScrollSettle: true }
            })
            define(`${mode}: visual-origin pan is corrected before keyboard motion capture`, async f => {
                f.focus(); f.move(f.layout - 300)
                await f.frames(80)
                f.shell.style.setProperty("--pan", "-24px")
                f.move(f.layout - 320)
                const motion = f.motionCaptures.at(-1)
                assert(Math.abs(motion.top) <= 2, `Motion captured displaced topbar at ${motion.top}px`)
                const samples = await f.frames(360)
                f.checkChrome(samples); f.checkGap(samples); f.checkEnd(f.layout - 320)
                return { captureTop: motion.top, frames: samples.length }
            })
            define(`${mode}: hidden tab retires motion and restores visible chat`, async f => {
                f.focus(); f.move(f.layout - 300)
                await f.frames(45)
                f.doc.body.dataset.workspaceTabActive = "false"
                f.view.dispatchEvent(new Event(WORKSPACE_TAB_VISIBILITY_EVENT))
                f.controller.suspend(); f.panel.hidden = true
                await delay(30)
                f.panel.hidden = false; f.doc.body.dataset.workspaceTabActive = "true"
                f.visualOrigin.resume(); f.controller.resume(); f.view.dispatchEvent(new Event(WORKSPACE_TAB_VISIBILITY_EVENT))
                f.mount.story.pane.dispatchEvent(new Event("conversation-visible"))
                f.move(f.layout)
                const samples = await f.frames(390)
                f.checkChrome(samples); f.checkGap(samples); f.checkEnd(f.layout)
                return { frames: samples.length }
            })
            define(`${mode}: departure mid-motion resumes at still-short viewport`, async f => {
                f.focus(); f.move(f.layout - 300)
                await f.frames(70)
                f.doc.body.dataset.workspaceTabActive = "false"
                f.view.dispatchEvent(new Event(WORKSPACE_TAB_VISIBILITY_EVENT))
                f.controller.blur(); f.controller.suspend(); f.origin.suspend()
                f.panel.hidden = true
                await delay(35)
                f.panel.hidden = false; f.doc.body.dataset.workspaceTabActive = "true"
                f.visualOrigin.resume(); f.origin.resume(); f.controller.resume(); f.controller.focus()
                f.view.dispatchEvent(new Event(WORKSPACE_TAB_VISIBILITY_EVENT))
                f.mount.story.pane.dispatchEvent(new Event("conversation-visible"))
                f.move(f.layout - 300)
                const samples = await f.frames(390)
                f.checkChrome(samples); f.checkGap(samples); f.checkEnd(f.layout - 300)
                return { frames: samples.length, finalHostBottom: f.sample().applied }
            })
            define(`${mode}: native selection survives keyboard motion`, async f => {
                f.mount.setText("one two three four")
                f.focus()
                const editor = f.q("[data-chat-composer]")
                const text = editor.querySelector(".cm-line").firstChild
                const range = f.doc.createRange()
                range.setStart(text, 4); range.setEnd(text, 13)
                const selection = f.doc.getSelection()
                selection.removeAllRanges(); selection.addRange(range)
                const selected = selection.toString()
                f.move(f.layout - 300)
                const samples = await f.frames(360)
                f.checkChrome(samples); f.checkGap(samples)
                assert(selection.toString() === selected, `Native selection changed from ${JSON.stringify(selected)} to ${JSON.stringify(selection.toString())}`)
                f.checkEnd(f.layout - 300)
                return { selection: selected, frames: samples.length }
            })
        }
    }
    function summarize(f, name) {
        const frames = f.measuredFrames
        let maxReverse = 0
        for (let index = 1; index < frames.length; index++) {
            const previous = frames[index - 1], current = frames[index]
            if (previous.target !== current.target) continue
            const toward = Math.sign(current.target - previous.footerBottom)
            if (toward) maxReverse = Math.max(maxReverse, Math.max(0, -toward * (current.footerBottom - previous.footerBottom)))
        }
        const maxChrome = Math.max(0, ...frames.map(row => Math.max(Math.abs(row.topbarTop), Math.abs(row.tabbarTop - 56), Math.abs(row.headerTop - 100))))
        const maxGap = Math.max(0, ...frames.map(row => Math.abs(row.gap - f.initial.gap)))
        return {
            frameCount: frames.length,
            maxChromeDisplacementPx: Math.round(100 * maxChrome) / 100,
            maxGapDeltaPx: name.includes("scrolled history") ? null : Math.round(100 * maxGap) / 100,
            maxUnintendedReversePx: Math.round(100 * maxReverse) / 100,
        }
    }
    const results = []
    for (const item of cases) {
        const mode = item.name.startsWith("resident-iframe") ? "resident-iframe" : "native"
        let f
        try {
            f = await fixture(mode)
            const observations = await item.action(f)
            results.push({ name: item.name, passed: true, observations, geometry: summarize(f, item.name) })
        } catch (error) {
            results.push({ name: item.name, passed: false, error: String(error?.message ?? error), sample: f?.sample(), diagnostics: f?.trace.slice(-8), geometry: f ? summarize(f, item.name) : null })
        } finally {
            f?.close()
        }
        document.querySelector("#result").textContent = JSON.stringify({ status: "running", cases: results }, null, 2)
    }
    const report = { status: "complete", total: cases.length, passed: results.filter(row => row.passed).length, cases: results, userAgent: navigator.userAgent, mode: desktop ? "desktop" : reduced ? "reduced-motion" : "mobile", baseline, limits: "Loopback synthetic chat, actual production motion/composer/editor/history observer/controller/origin modules. Browser viewport injection, not authenticated UI or a physical keyboard/device." }
    window.commsLayoutFixtureResult = report
    document.querySelector("#result").textContent = JSON.stringify(report, null, 2)
}
