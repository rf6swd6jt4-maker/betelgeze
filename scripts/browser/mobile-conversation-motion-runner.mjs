import { observeMobileConversationMotion } from "/lib/mobile-conversation-motion.js"
import { observeConversationLayout } from "/components/communications/message-pane-observer.js"
import { latestMessageIsVisible } from "/lib/communications/reading-visibility.js"
import { anchoredPopupPosition } from "/components/ui/anchored-popup-position.js"

const assert = (value, message) => { if (!value) throw Error(message) }
const near = (actual, expected, message, tolerance = 1.5) => assert(Math.abs(actual - expected) < tolerance, `${message}: ${actual}; expected ${expected}`)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
const wallNow = performance.now.bind(performance)
const until = async (check, message) => { const deadline = wallNow() + 2500; while (!check()) { if (wallNow() > deadline) throw Error(message); await frame() } }
const cases = []
const define = (name, action, options = {}) => cases.push({ name, action, options })

async function fixture({ count = 60, reduced = false } = {}) {
    const originalMatchMedia = window.matchMedia.bind(window)
    const reduction = Object.assign(new EventTarget(), { matches: reduced, media: "(prefers-reduced-motion: reduce)" })
    window.matchMedia = query => query === reduction.media ? reduction : originalMatchMedia(query)
    const surface = document.createElement("section")
    surface.dataset.mobileConversationSurface = "true"
    surface.dataset.phase = "open"
    surface.innerHTML = `<section data-native-chat-viewport><header class="fixture-header">Synthetic conversation</header><div data-chat-motion-viewport><div data-chat-motion-layer><div class="fixture-pane-wrapper"><div data-message-pane tabindex="0"><div class="fixture-stack"><div class="fixture-spacer" aria-hidden="true"></div>${Array.from({ length: count }, (_, i) => `<div class="fixture-message" data-message-scroll-anchor="${i}" data-message-interaction="${i}">Synthetic message ${i + 1}</div>`).join("")}</div></div></div><div data-composer-slot><footer><textarea data-chat-composer aria-label="Synthetic draft"></textarea></footer></div></div></div></section>`
    document.querySelector("#stage").append(surface)
    const q = selector => surface.querySelector(selector)
    const clip = q("[data-chat-motion-viewport]"), layer = q("[data-chat-motion-layer]"), pane = q("[data-message-pane]"), header = q("header"), footer = q("footer"), slot = q("[data-composer-slot]"), rows = [...q(".fixture-stack").querySelectorAll("[data-message-scroll-anchor]")]
    const follow = { current: true }, writes = []
    const nativeScrollTo = pane.scrollTo.bind(pane)
    pane.scrollTo = (...args) => { writes.push({ before: pane.scrollTop, top: args[0]?.top ?? args[1] }); return nativeScrollTo(...args) }
    let stopMotion = observeMobileConversationMotion(clip, layer)
    const stopLayout = observeConversationLayout(pane, follow, () => {})
    await frame(); await frame()
    const rect = element => element.getBoundingClientRect()
    const geometry = (marker = rows.at(-1)) => ({ origin: rect(surface).top, height: rect(surface).height, header: rect(header).top, headerHeight: rect(header).height, footer: rect(footer).top, footerBottom: rect(footer).bottom, marker: rect(marker).bottom, gap: rect(footer).top - rect(marker).bottom, paneHeight: pane.clientHeight, scroll: pane.scrollTop, max: pane.scrollHeight - pane.clientHeight })
    const move = (height, top = parseFloat(surface.style.top) || 0) => {
        pane.dispatchEvent(new Event("conversation-layout-will-change"))
        surface.style.height = `${height}px`
        surface.style.top = `${top}px`
        pane.dispatchEvent(new Event("conversation-layout-commit"))
    }
    const animation = () => layer.getAnimations().find(item => item.effect?.target === layer && item.playState !== "finished") ?? layer.getAnimations().find(item => item.effect?.target === layer)
    const seek = async proportion => {
        const current = animation()
        assert(current, "No shared messages/composer animation was created")
        current.pause()
        await current.ready
        const duration = Number(current.effect.getTiming().duration)
        assert(Number.isFinite(duration) && duration > 0, "Animation has no finite duration")
        current.currentTime = duration * proportion
        await frame()
        return current
    }
    const finish = async () => {
        const current = animation()
        if (current) current.finish()
        await frame(); await frame()
    }
    const settled = async () => { await until(() => !layer.getAnimations().length && !layer.style.height && !layer.style.transform, "Temporary motion geometry did not retire"); await frame() }
    const touch = type => {
        const event = new Event(type, { bubbles: true })
        Object.defineProperty(event, "touches", { value: type === "touchstart" ? [{}] : [] })
        pane.dispatchEvent(event)
    }
    const nativeScroll = top => { pane.scrollTop = top; pane.dispatchEvent(new Event("scroll")) }
    const history = async top => { follow.current = false; nativeScroll(top); await frame(); pane.dispatchEvent(new Event("conversation-layout-will-change")); writes.length = 0 }
    const stableFrame = (height, origin = 0) => {
        const data = geometry()
        near(data.height, height, "Motion changed root's measured height")
        near(data.origin, origin, "Motion changed root origin")
        near(data.header, origin, "Header moved independently of root")
        near(data.headerHeight, 56, "Header height changed")
        assert(getComputedStyle(surface).transform === "none" && getComputedStyle(header).transform === "none", "Motion transformed root/header")
        return data
    }
    const disposeMotion = () => { stopMotion(); stopMotion = () => {} }
    return { surface, clip, layer, pane, slot, rows, footer, follow, writes, reduction, geometry, move, animation, seek, finish, settled, touch, nativeScroll, history, stableFrame, disposeMotion,
        async close() { stopMotion(); stopLayout(); surface.remove(); window.matchMedia = originalMatchMedia; await frame() },
    }
}

async function sampleShared(f, targetHeight, before, marker, targetOrigin = 0) {
    const samples = []
    for (const progress of [0, 0.2, 0.5, 0.8, 0.99]) {
        await f.seek(progress)
        const data = f.stableFrame(targetHeight, targetOrigin), markerData = f.geometry(marker)
        if (progress === 0) {
            near(markerData.footer, before.footer, "Animation started by snapping the composer")
            near(markerData.marker, before.marker, "Animation started by snapping messages")
        }
        near(markerData.gap, before.gap, `Message/composer gap changed at ${progress}`)
        near(markerData.marker - before.marker, markerData.footer - before.footer, `Messages separated from composer at ${progress}`)
        samples.push({ progress, marker: markerData.marker, footer: markerData.footer })
        assert(Number.isFinite(data.scroll) && data.scroll >= 0, "Motion produced an invalid message scroll")
    }
    assert(Math.abs(samples.at(-1).footer - samples[0].footer) > 200, "The sampled animation did not move through the keyboard displacement")
    return samples
}

// Drive the input clock independently of the display refresh rate. The browser
// still evaluates the real WAAPI effect and DOM geometry at each sampled time.
async function withMotionClock(action) {
    const original = Object.getOwnPropertyDescriptor(performance, "now")
    let time = wallNow()
    Object.defineProperty(performance, "now", { configurable: true, value: () => time })
    try { return await action({ now: () => time, advance: amount => { time += amount } }) }
    finally {
        if (original) Object.defineProperty(performance, "now", original)
        else delete performance.now
    }
}
function paintedAt(f, animation, time) {
    assert(animation, "The input sequence lost its active animation")
    animation.pause()
    animation.currentTime = time
    return f.geometry()
}
function naturalMotion(f, height) {
    const data = f.stableFrame(height)
    assert(!f.layer.getAnimations().length && !f.pane.getAnimations().length, "Natural layout retained cosmetic animation")
    assert(!f.layer.style.height && !f.layer.style.transform && !f.layer.style.willChange && !f.pane.style.paddingTop,
        "Natural layout retained temporary motion geometry")
    assert(!f.clip.dataset.chatViewportMoving, "Natural layout retained the moving marker")
    near(data.footerBottom, height, "Natural composer missed the current viewport edge")
    return data
}
function presentAnchoredPopup(f, anchor) {
    const popup = document.createElement("div")
    popup.dataset.anchoredPopup = "true"
    popup.style.cssText = "position:fixed;visibility:hidden;width:220px;height:160px;background:#333;z-index:100"
    document.body.append(popup)
    // Mirror AnchoredPopup's synchronous handoff before its first measurement;
    // placement itself uses the production helper, including viewport clamping.
    anchor.dispatchEvent(new Event("betelgeze:anchored-popup-opening", { bubbles: true }))
    const viewport = f.surface.getBoundingClientRect()
    const position = anchoredPopupPosition({ trigger: anchor.getBoundingClientRect(), popupWidth: 220, popupHeight: 160,
        viewport: { left: viewport.left, top: viewport.top, width: viewport.width, height: viewport.height }, align: "center", fallbackBelow: true })
    Object.assign(popup.style, { left: `${position.left}px`, top: `${position.top}px`, maxWidth: `${position.maxWidth}px`, maxHeight: `${position.maxHeight}px`, visibility: "visible" })
    return popup
}
function popupInsideSurface(f, popup) {
    const bounds = popup.getBoundingClientRect(), viewport = f.surface.getBoundingClientRect()
    assert(bounds.left >= viewport.left + 7.5 && bounds.right <= viewport.right - 7.5
        && bounds.top >= viewport.top + 7.5 && bounds.bottom <= viewport.bottom - 7.5,
    "Popup escaped the current visible conversation")
    return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
}

define("retargeting preserves measured velocity as well as the painted position", async f => withMotionClock(async clock => {
    f.move(524)
    const original = f.animation(), time = 80, epsilon = 0.5
    const left = paintedAt(f, original, time - epsilon)
    const right = paintedAt(f, original, time + epsilon)
    const velocity = (right.footer - left.footer) / (2 * epsilon)
    const before = paintedAt(f, original, time)
    clock.advance(time)
    f.move(484)
    const next = f.animation(), resumed = paintedAt(f, next, 0)
    const after = paintedAt(f, next, epsilon)
    const resumedVelocity = (after.footer - resumed.footer) / epsilon
    near(resumed.footer, before.footer, "Retargeting jumped the current composer position", 0.25)
    near(resumed.marker, before.marker, "Retargeting jumped the current message position", 0.25)
    assert(Math.abs(velocity) > 0.1, "Velocity regression did not sample moving content")
    near(resumedVelocity, velocity, "Retargeting reset the instantaneous motion speed", Math.max(0.04, Math.abs(velocity) * 0.05))
    near(after.gap, before.gap, "Velocity handoff separated the composer and messages")
    await f.finish(); await f.settled()
    naturalMotion(f, 484)
    return { velocity, resumedVelocity, handoffDisplacement: resumed.footer - before.footer }
}))

define("one-pixel target oscillations keep one completion deadline and shared paint", async f => withMotionClock(async clock => {
    f.move(524)
    const deadline = clock.now() + Number(f.animation().effect.getTiming().duration)
    let elapsed = 80
    const samples = []
    for (const height of [525, 524, 525, 524, 525, 524]) {
        const before = paintedAt(f, f.animation(), elapsed)
        clock.advance(elapsed)
        f.move(height)
        const current = f.animation(), after = paintedAt(f, current, 0)
        near(clock.now() + Number(current.effect.getTiming().duration), deadline, "One-pixel noise restarted the completion deadline", 0.5)
        near(after.footer, before.footer, "One-pixel noise jumped the composer", 0.25)
        near(after.marker, before.marker, "One-pixel noise jumped messages", 0.25)
        near(after.gap, before.gap, "One-pixel noise changed the message/composer gap")
        f.stableFrame(height)
        samples.push({ height, remaining: Number(current.effect.getTiming().duration) })
        elapsed = 8
    }
    await f.finish(); await f.settled()
    naturalMotion(f, 524)
    return { samples, oneDeadline: true }
}))

for (const interval of [16, 8]) define(`progressive ${interval}ms viewport inputs retain continuous shared paint and one deadline`, async f => withMotionClock(async clock => {
    const gap = f.geometry().gap
    f.move(828)
    const duration = Number(f.animation().effect.getTiming().duration)
    const deadline = clock.now() + duration
    const samples = []
    const steps = 192 / interval
    let previousFooter = f.geometry().footer
    for (let index = 1; index <= steps; index++) {
        const before = paintedAt(f, f.animation(), interval)
        clock.advance(interval)
        const height = Math.round(828 - 304 * index / steps)
        f.move(height)
        const current = f.animation(), after = paintedAt(f, current, 0)
        near(after.footer, before.footer, "Progressive viewport input jumped the composer", 0.25)
        near(after.marker, before.marker, "Progressive viewport input jumped messages", 0.25)
        near(after.gap, gap, "Progressive viewport input detached messages from composer")
        near(clock.now() + Number(current.effect.getTiming().duration), deadline, "Progressive viewport input extended the completion deadline", 0.5)
        assert(after.footer <= previousFooter + 0.25, "A shrinking viewport reversed the painted movement")
        f.stableFrame(height)
        previousFooter = after.footer
        samples.push({ time: index * interval, height, footer: after.footer })
    }
    const current = f.animation(), remaining = Number(current.effect.getTiming().duration)
    const endpoint = paintedAt(f, current, remaining - 0.01)
    near(endpoint.footerBottom, 524, "Continuous viewport input did not converge by its deadline", 0.5)
    near(endpoint.gap, gap, "Continuous viewport input changed gap at its deadline")
    await f.finish(); await f.settled()
    naturalMotion(f, 524)
    return { interval, inputs: steps, duration, samples, finalHeight: 524 }
}))

define("width-only reflow retires old-width motion without moving the header or draft", async f => {
    const editor = f.surface.querySelector("textarea")
    editor.value = "first line\nsecond line"
    editor.focus({ preventScroll: true })
    editor.setSelectionRange(7, 7)
    f.move(524); await f.seek(0.4)
    f.surface.style.width = "320px"
    await frame(); await frame()
    naturalMotion(f, 524)
    near(f.surface.getBoundingClientRect().width, 320, "Width-only reflow changed the requested width")
    assert(document.activeElement === editor && editor.value === "first line\nsecond line" && editor.selectionStart === 7,
        "Width-only reflow changed composer focus, draft or caret")
    await wait(64)
    f.move(600)
    assert(f.animation(), "Height motion did not recover after width-only reflow settled")
    await f.finish(); await f.settled()
    naturalMotion(f, 600)
    return { width: 320, draftPreserved: true, recoveredHeight: 600 }
})

define("rotation during native scrolling drops stale geometry and later height motion recovers", async f => {
    await f.history(900)
    f.touch("touchstart"); f.nativeScroll(880)
    f.move(524); await f.seek(0.4)
    f.writes.length = 0
    // A real resize can change width before the viewport notification arrives.
    f.surface.style.width = "640px"
    f.move(390)
    await frame(); await frame()
    naturalMotion(f, 390)
    assert(f.writes.length === 0, "Rotation stole native scroll ownership")
    assert(f.pane.scrollTop >= 0 && f.pane.scrollTop <= f.pane.scrollHeight - f.pane.clientHeight,
        "Rotation left the message scroller outside its natural bounds")
    f.touch("touchend")
    await wait(260)
    f.move(460)
    assert(f.animation(), "Height motion remained disabled after rotation settled")
    await f.finish(); await f.settled()
    naturalMotion(f, 460)
    return { rotatedWidth: 640, rotatedHeight: 390, recoveredHeight: 460 }
})

define("keyboard opening animates messages and composer together beneath a stationary header", async f => {
    const before = f.geometry()
    f.move(524)
    const samples = await sampleShared(f, 524, before)
    await f.finish(); await f.settled()
    const after = f.stableFrame(524)
    near(after.footerBottom, 524, "Composer did not reach the keyboard edge")
    near(after.gap, before.gap, "Final latest gap changed")
    near(after.scroll, after.max, "Latest messages did not settle at bottom")
    return { samples, finalScroll: after.scroll }
})
define("keyboard closing preserves the same message/composer gap without a terminal jump", async f => {
    f.move(524); await f.finish(); await f.settled()
    const before = f.geometry()
    f.move(844)
    const samples = await sampleShared(f, 844, before)
    await f.finish(); await f.settled()
    const after = f.stableFrame(844)
    near(after.footerBottom, 844, "Composer did not return to lower edge")
    near(after.gap, before.gap, "Closing changed latest gap")
    near(after.scroll, after.max, "Closing lost latest scroll position")
    return { samples, finalScroll: after.scroll }
})
define("reading older history retains its bottom-relative message through opening and closing", async f => {
    await f.history(900)
    const marker = f.rows[24], before = f.geometry(marker)
    f.move(524)
    await sampleShared(f, 524, before, marker)
    await f.finish(); await f.settled()
    near(f.geometry(marker).gap, before.gap, "Older message jumped after opening")
    near(f.pane.scrollTop, 1220, "Older history did not compensate exactly once")
    const open = f.geometry(marker)
    f.move(844)
    await sampleShared(f, 844, open, marker)
    await f.finish(); await f.settled()
    near(f.geometry(marker).gap, before.gap, "Older message jumped after closing")
    near(f.pane.scrollTop, 900, "Opening/closing drifted older history")
    assert(!f.follow.current, "Motion changed user's history-follow preference")
    return { initialScroll: 900, finalScroll: f.pane.scrollTop }
})
define("short bottom-aligned conversations travel with composer and never acquire negative scroll", async f => {
    const before = f.geometry()
    near(before.scroll, 0, "Short fixture unexpectedly scrolls")
    f.move(524)
    await sampleShared(f, 524, before)
    await f.finish(); await f.settled()
    near(f.geometry().gap, before.gap, "Short conversation jumped when animation retired")
    near(f.pane.scrollTop, 0, "Short conversation acquired scroll")
    f.move(844); await f.finish(); await f.settled()
    near(f.geometry().gap, before.gap, "Short conversation lost bottom alignment on closing")
    return { gap: before.gap, scroll: f.pane.scrollTop }
}, { count: 3 })
define("a first row arriving during held empty-chat motion retires the composer target before paint", async f => {
    const stack = f.pane.firstElementChild
    f.pane.dataset.empty = "true"
    const prompt = document.createElement("div")
    prompt.dataset.conversationEmpty = "true"
    prompt.style.cssText = "height:120px;flex:none"
    prompt.textContent = "Synthetic empty prompt"
    stack.replaceChildren(prompt)
    await frame()
    f.move(524)
    const animation = f.slot.getAnimations()[0]
    assert(animation && !f.layer.getAnimations().length, "Empty-chat fixture did not animate only its composer")
    animation.pause(); await animation.ready
    animation.currentTime = 50
    await frame()
    f.touch("touchstart"); f.nativeScroll(0); f.writes.length = 0
    delete f.pane.dataset.empty
    const spacer = document.createElement("div"), row = document.createElement("div")
    spacer.className = "fixture-spacer"
    row.className = "fixture-message"
    row.dataset.messageScrollAnchor = "first"
    row.textContent = "Synthetic first message"
    stack.replaceChildren(spacer, row)
    await Promise.resolve(); await frame()
    assert(!f.slot.getAnimations().length && !f.layer.getAnimations().length,
        "First arrival retained the obsolete composer-only animation during a held touch")
    assert(!f.slot.style.willChange && !f.slot.style.transform, "First arrival left stale composer presentation styles")
    naturalMotion(f, 524)
    const gap = f.geometry(row).gap
    await wait(80)
    near(f.geometry(row).gap, gap, "First row separated from composer while touch remained held")
    assert(f.writes.length === 0, "First-arrival presentation handoff took native scroll ownership")
    f.touch("touchend"); await wait(260)
    near(f.geometry(row).gap, gap, "Touch settlement replayed the first-arrival displacement")
    assert(f.writes.length === 0, "First-arrival handoff queued a delayed scroll correction")
    f.move(844)
    assert(f.layer.getAnimations().length === 1 && !f.slot.getAnimations().length,
        "Populated conversation reused the empty composer motion target")
    await f.finish(); await f.settled()
    naturalMotion(f, 844)
    return { gap, nativeScrollWrites: 0, nextTarget: "message-layer" }
}, { count: 1 })
define("removing the final row during a held touch retires shared motion before presenting the empty prompt", async f => {
    f.move(524); await f.seek(0.2)
    f.touch("touchstart"); f.nativeScroll(0); f.writes.length = 0
    f.pane.dataset.empty = "true"
    const prompt = document.createElement("div")
    prompt.dataset.conversationEmpty = "true"
    prompt.style.cssText = "height:120px;flex:none"
    prompt.textContent = "Synthetic empty prompt"
    f.pane.firstElementChild.replaceChildren(prompt)
    await Promise.resolve(); await frame()
    assert(!f.layer.getAnimations().length && !f.slot.getAnimations().length,
        "Last-row removal retained shared motion on the empty prompt during a held touch")
    naturalMotion(f, 524)
    const top = prompt.getBoundingClientRect().top
    assert(top >= f.pane.getBoundingClientRect().top, "Restored empty prompt was displaced above the pane")
    await wait(80)
    near(prompt.getBoundingClientRect().top, top, "Empty prompt continued moving after last-row removal")
    assert(f.writes.length === 0, "Last-removal presentation handoff took native scroll ownership")
    f.touch("touchend"); await wait(260)
    near(prompt.getBoundingClientRect().top, top, "Touch settlement moved the restored empty prompt")
    assert(f.writes.length === 0, "Last-removal handoff queued a delayed scroll correction")
    f.move(844)
    const animation = f.slot.getAnimations()[0]
    assert(animation && !f.layer.getAnimations().length, "Restored empty conversation reused shared message motion")
    animation.finish(); await frame(); await frame()
    assert(!f.slot.getAnimations().length && !f.slot.style.willChange && !f.slot.style.transform,
        "Restored empty composer kept stale motion after completion")
    naturalMotion(f, 844)
    return { promptTop: top, nativeScrollWrites: 0, nextTarget: "composer-slot" }
}, { count: 1 })
define("a changed target retargets from the currently painted composer and message positions", async f => {
    f.move(524); await f.seek(0.2)
    const painted = f.geometry()
    f.move(484)
    await f.seek(0)
    const resumed = f.stableFrame(484)
    near(resumed.footer, painted.footer, "Retarget snapped composer to a previous endpoint")
    near(resumed.marker, painted.marker, "Retarget snapped messages")
    await f.finish(); await f.settled()
    near(f.geometry().footerBottom, 484, "Retarget did not settle to current viewport")
    near(f.geometry().gap, painted.gap, "Retarget changed gap")
    return { beforeRetarget: painted.footer, afterRetarget: resumed.footer }
})
define("rapid reversal starts at the painted midpoint and returns to the current full height", async f => {
    f.move(524); await f.seek(0.5)
    const painted = f.geometry()
    f.move(844)
    await f.seek(0)
    near(f.geometry().footer, painted.footer, "Reversal snapped composer")
    near(f.geometry().marker, painted.marker, "Reversal snapped message")
    await f.finish(); await f.settled()
    const after = f.stableFrame(844)
    near(after.footerBottom, 844, "Reversal finished at stale keyboard target")
    near(after.scroll, after.max, "Reversal lost latest position")
    return { finalHeight: after.height, gap: after.gap }
})
define("an active message drag and its momentum keep native scroll ownership until settlement", async f => {
    await f.history(1000)
    f.touch("touchstart"); f.nativeScroll(940); f.writes.length = 0
    const before = f.geometry(f.rows[24])
    f.move(524)
    await sampleShared(f, 524, before, f.rows[24])
    await f.finish()
    assert(f.writes.length === 0, "Motion wrote message scroll while finger remained down")
    f.touch("touchend")
    await wait(80)
    f.nativeScroll(900)
    await wait(150)
    assert(f.writes.length === 0, "Motion wrote scroll during native momentum")
    const beforeSettle = f.geometry(f.rows[24])
    await f.settled()
    const after = f.geometry(f.rows[24])
    near(after.gap, beforeSettle.gap, "Settlement replayed a stale correction over newer native scroll")
    near(after.footerBottom, 524, "Settlement did not reach keyboard edge")
    assert(!f.follow.current, "Gesture motion switched history back to latest")
    return { writesAfterSettle: f.writes.length, finalScroll: f.pane.scrollTop }
})
define("keyboard closing during a native scroll keeps messages attached without an initial or final snap", async f => {
    f.move(524); await f.finish(); await f.settled()
    await f.history(1200)
    f.touch("touchstart"); f.nativeScroll(1160); f.writes.length = 0
    const before = f.geometry(f.rows[30])
    f.move(844)
    await sampleShared(f, 844, before, f.rows[30])
    await f.finish()
    assert(f.writes.length === 0, "Closing wrote scroll during a native drag")
    f.touch("touchend"); f.nativeScroll(1120)
    await wait(120)
    assert(f.writes.length === 0, "Closing wrote scroll during momentum")
    const beforeSettle = f.geometry(f.rows[30])
    await f.settled()
    near(f.geometry(f.rows[30]).gap, beforeSettle.gap, "Closing settlement replayed an obsolete history position")
    near(f.geometry().footerBottom, 844, "Closing did not finish at full usable height")
    return { finalScroll: f.pane.scrollTop, writesAfterSettle: f.writes.length }
})
define("document-origin changes never get absorbed into message/composer displacement", async f => {
    f.move(524, 80)
    await f.seek(0.5)
    f.stableFrame(524, 80)
    await f.finish(); await f.settled()
    const after = f.stableFrame(524, 80)
    near(after.footerBottom, 604, "Composer combined viewport origin and height incorrectly")
    return { rootTop: after.origin, rootHeight: after.height, headerTop: after.header, footerBottom: after.footerBottom }
})
define("reduced motion applies one final natural layout with no animation or temporary geometry", async f => {
    const before = f.geometry()
    f.move(524)
    await frame(); await f.settled()
    assert(!f.animation(), "Reduced motion created an animation")
    const after = f.stableFrame(524)
    near(after.footerBottom, 524, "Reduced motion composer did not reach edge")
    near(after.gap, before.gap, "Reduced motion changed latest gap")
    near(after.scroll, after.max, "Reduced motion lost latest position")
    return { gap: after.gap, animations: f.layer.getAnimations().length }
}, { reduced: true })
define("natural composer growth remains flex layout and keeps latest content attached", async f => {
    const before = f.geometry()
    f.slot.style.height = "139px"
    await frame(); await frame()
    const after = f.stableFrame(844)
    assert(!f.animation(), "Typing-only composer growth started a keyboard animation")
    assert(!f.layer.style.height, "Typing-only composer growth pinned motion layer height")
    near(after.footerBottom, 844, "Growing composer changed lower edge")
    near(after.gap, before.gap, "Growing composer detached latest message")
    near(after.scroll - before.scroll, 56, "Composer growth did not anchor exactly once")
    return { growth: 56, scrollDelta: after.scroll - before.scroll }
})
define("departure cleanup cancels animation and gesture state without leaving temporary layer styles", async f => {
    f.move(524); await f.seek(0.5)
    f.touch("touchstart")
    f.disposeMotion()
    assert(!f.layer.getAnimations().length, "Departure kept a live animation")
    assert(!f.layer.style.height && !f.layer.style.transform && !f.layer.style.willChange, "Departure retained temporary motion styles")
    assert(!f.clip.dataset.chatViewportMoving, "Departure retained motion ownership")
    f.surface.hidden = true
    f.move(844)
    f.surface.hidden = false
    await frame()
    assert(!f.layer.getAnimations().length, "Disposed controller animated a later activation")
    return { cleaned: true }
})
define("an anchored popup retains natural positioning and blocks the covered latest row from reading", async f => {
    assert(latestMessageIsVisible(f.pane, "59"), "Uncovered latest row was not visible before popup")
    const popup = document.createElement("div")
    popup.dataset.anchoredPopup = "true"
    popup.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100"
    document.body.append(popup)
    try {
        f.move(524)
        await frame()
        assert(!f.layer.getAnimations().length, "Popup anchor was moved by a keyboard animation")
        assert(!latestMessageIsVisible(f.pane, "59"), "Covered row incorrectly counted as read-visible")
        near(f.geometry().footerBottom, 524, "Popup fallback did not commit current geometry")
    } finally { popup.remove() }
    assert(latestMessageIsVisible(f.pane, "59"), "Uncovering current latest row did not restore visibility")
    return { animationSkipped: true, coveredVisible: false, uncoveredVisible: true }
})
define("an anchored popup opened mid-motion retires the moving anchor before its first paint", async f => {
    f.move(524); await f.finish(); await f.settled()
    f.move(844); await f.seek(0.2)
    const popup = presentAnchoredPopup(f, f.footer)
    try {
        assert(!f.animation(), "Popup measured before its moving anchor settled")
        naturalMotion(f, 844)
        const settledAnchor = f.geometry().footer
        const menu = popupInsideSurface(f, popup)
        await frame(); await frame()
        near(f.geometry().footer, settledAnchor, "Popup anchor kept moving after presentation retired")
        return { naturalLayoutBeforePopupPaint: true, finalAnchor: settledAnchor, menu }
    } finally { popup.remove() }
})
define("a popup opened during a held history touch settles cosmetics without taking native scroll ownership", async f => {
    f.move(524); await f.finish(); await f.settled()
    await f.history(900)
    f.touch("touchstart"); f.nativeScroll(880)
    f.move(844); await f.seek(0.3)
    f.writes.length = 0
    const anchor = f.rows[30], popup = presentAnchoredPopup(f, anchor)
    try {
        naturalMotion(f, 844)
        assert(f.writes.length === 0, "Popup handoff wrote scroll while a finger remained down")
        const marker = f.geometry(anchor).marker
        const menu = popupInsideSurface(f, popup)
        await wait(80)
        near(f.geometry(anchor).marker, marker, "Held popup anchor drifted after measuring")
        assert(f.writes.length === 0, "Held popup handoff replayed a delayed scroll write")
        f.touch("touchend")
        await wait(300)
        naturalMotion(f, 844)
        near(f.geometry(anchor).marker, marker, "Touch settlement moved the already measured popup anchor")
        assert(f.writes.length === 0, "Touch settlement replayed an obsolete history correction")
        popupInsideSurface(f, popup)
        return { nativeScrollWrites: f.writes.length, anchorBeforeAndAfter: marker, menu }
    } finally { popup.remove() }
})
define("clipping during motion cannot make an unpainted latest row count as read-visible", async f => {
    assert(latestMessageIsVisible(f.pane, "59"), "Initial latest row is not visibly painted")
    f.move(524); await f.seek(0)
    assert(!latestMessageIsVisible(f.pane, "59"), "Clipped motion row incorrectly counted as read-visible")
    await f.finish(); await f.settled()
    assert(latestMessageIsVisible(f.pane, "59"), "Settled latest row did not become visibly readable")
    return { duringClipping: false, afterSettlement: true }
})
define("arrival of a message retires idle motion before the existing two-frame reading check", async f => {
    f.move(524); await f.seek(0)
    const added = document.createElement("div")
    added.className = "fixture-message"
    added.dataset.messageScrollAnchor = "incoming"
    added.dataset.messageInteraction = "incoming"
    added.textContent = "Synthetic incoming message"
    f.pane.firstElementChild.append(added)
    await Promise.resolve()
    assert(!f.layer.getAnimations().length, "New message stayed inside a pending keyboard animation")
    // Mirrors the reader's existing paint delay; this fixture never invokes reads.
    await frame(); await frame()
    assert(latestMessageIsVisible(f.pane, "incoming"), "Current incoming message remained obscured at the existing read check")
    near(f.geometry(added).gap, 20, "Message arrival detached the newest row from composer")
    return { stoppedBeforePaintCheck: true, newestVisible: true }
})
define("hiding during a lost touch retires motion so the next activation can animate normally", async f => {
    f.move(524); await f.seek(0.3); f.touch("touchstart")
    f.surface.hidden = true
    await Promise.resolve()
    assert(!f.layer.getAnimations().length && !f.layer.style.height && !f.layer.style.willChange, "Hidden surface kept old motion ownership")
    f.surface.hidden = false
    f.move(844); await f.finish(); await f.settled()
    f.move(524); await f.finish(); await f.settled()
    const after = f.stableFrame(524)
    near(after.footerBottom, 524, "Returning surface kept an obsolete keyboard target")
    near(after.scroll, after.max, "Returning surface kept stale touch ownership")
    return { resumed: true, gap: after.gap }
})
define("composer growth during keyboard animation stays attached without moving the header", async f => {
    f.move(524); await f.seek(0.3)
    const before = f.geometry()
    f.slot.style.height = "139px"
    await frame(); await frame()
    const during = f.stableFrame(524)
    near(during.gap, before.gap, "Growing draft separated messages from the animated composer")
    await f.finish(); await f.settled()
    const after = f.stableFrame(524)
    near(after.footerBottom, 524, "Growing draft left composer above or below keyboard")
    near(after.gap, before.gap, "Finishing animation after draft growth changed gap")
    near(after.scroll, after.max, "Draft growth during motion lost latest position")
    return { growth: 56, gap: after.gap }
})
define("closing near the oldest message releases an unavailable negative scroll through continuous paint", async f => {
    f.move(524); await f.finish(); await f.settled()
    await f.history(50)
    f.touch("touchstart"); f.nativeScroll(20); f.writes.length = 0
    const marker = f.rows[0], before = f.geometry(marker)
    f.move(844)
    await sampleShared(f, 844, before, marker)
    await f.finish()
    assert(f.writes.length === 0, "Oldest-boundary closing wrote scroll during touch")
    const endpoint = f.geometry(marker)
    const originalAnimate = f.pane.animate.bind(f.pane)
    let boundary = null
    f.pane.animate = (...args) => {
        const current = originalAnimate(...args)
        current.pause()
        boundary = current
        return current
    }
    try {
        f.touch("touchend")
        await until(() => boundary, "Oldest boundary jumped instead of creating continuous paint retirement")
        await boundary.ready
        boundary.currentTime = 0
        await frame()
        near(f.geometry(marker).marker, endpoint.marker, "Oldest-boundary retirement started with a message jump")
        near(f.geometry().footerBottom, 844, "Oldest-boundary retirement moved composer away from edge")
        const duration = Number(boundary.effect.getTiming().duration), samples = []
        for (const progress of [0, 0.25, 0.5, 0.75, 0.99]) {
            boundary.currentTime = duration * progress
            await frame()
            f.stableFrame(844)
            samples.push(f.geometry(marker).marker)
        }
        assert(samples.every((position, i) => i === 0 || position <= samples[i - 1]), "Oldest-boundary retirement reversed its motion")
        assert(samples[0] - samples.at(-1) > 200, "Unavailable scroll was not retired visually")
        boundary.finish(); await frame(); await frame()
        assert(!f.pane.getAnimations().length && !f.layer.getAnimations().length, "Oldest boundary retained an animation")
        assert(!f.pane.style.paddingTop, "Oldest boundary retained temporary pane padding")
        near(parseFloat(getComputedStyle(f.pane).paddingTop), 20, "Oldest boundary changed natural padding")
        near(f.pane.scrollTop, 0, "Oldest boundary did not clamp to real history start")
        assert(f.writes.every(write => write.top >= 0), "Oldest boundary requested impossible negative scroll")
        return { samples, finalScroll: f.pane.scrollTop, padding: getComputedStyle(f.pane).paddingTop }
    } finally { f.pane.animate = originalAnimate }
})

async function atOldestBoundary(f) {
    f.move(524); await f.finish(); await f.settled()
    await f.history(50)
    f.touch("touchstart"); f.nativeScroll(20)
    f.move(844); await f.finish()
    const originalAnimate = f.pane.animate.bind(f.pane)
    let boundary = null
    f.pane.animate = (...args) => {
        const current = originalAnimate(...args)
        current.pause()
        boundary = current
        return current
    }
    try {
        f.touch("touchend")
        await until(() => boundary, "Fixture did not reach oldest-history boundary retirement")
        await boundary.ready
        boundary.currentTime = Number(boundary.effect.getTiming().duration) * 0.5
        await frame()
        return boundary
    } finally { f.pane.animate = originalAnimate }
}
async function completelySettled(f) {
    await until(() => !f.layer.getAnimations().length && !f.pane.getAnimations().length && !f.layer.style.height && !f.pane.style.paddingTop,
        "Boundary interruption left temporary motion geometry")
    await frame()
}
define("rapid keyboard reopening absorbs the current oldest-boundary paint without a second jump", async f => {
    await atOldestBoundary(f)
    const before = f.geometry(f.rows[0])
    f.move(524); await f.seek(0)
    const after = f.stableFrame(524)
    near(f.geometry(f.rows[0]).marker, before.marker, "Reopening snapped the oldest message from current paint")
    near(after.footer, before.footer, "Reopening snapped the composer from current paint")
    assert(!f.pane.getAnimations().length, "Reopening retained a competing pane animation")
    await f.finish(); await completelySettled(f)
    near(f.geometry().footerBottom, 524, "Reopening settled to a stale keyboard target")
    near(f.geometry(f.rows[0]).gap, before.gap, "Reopening lost the bottom-relative history position")
    assert(f.pane.scrollTop >= 0 && f.pane.scrollTop <= f.pane.scrollHeight - f.pane.clientHeight, "Reopening produced an invalid scroll position")
    return { firstMessageBefore: before.marker, firstMessageAfter: f.geometry(f.rows[0]).marker, settled: true }
})
define("touch and wheel interrupt oldest-boundary motion at its current paint until native ownership settles", async f => {
    const observations = []
    for (const input of ["touch", "wheel"]) {
        await atOldestBoundary(f)
        const before = f.geometry(f.rows[0])
        f.writes.length = 0
        if (input === "touch") f.touch("touchstart")
        else f.pane.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 1 }))
        near(f.geometry(f.rows[0]).marker, before.marker, `${input} snapped an interrupted boundary`)
        assert(!f.pane.getAnimations().length, `${input} retained animation against native ownership`)
        await wait(input === "touch" ? 260 : 120)
        near(f.geometry(f.rows[0]).marker, before.marker, `${input} allowed paint to drift before settlement`)
        assert(f.writes.length === 0, `${input} wrote scroll before native ownership ended`)
        if (input === "touch") f.touch("touchend")
        await completelySettled(f)
        f.stableFrame(844)
        near(f.pane.scrollTop, 0, `${input} did not restore valid oldest-history scroll`)
        observations.push({ input, preservedPaint: before.marker, settled: true })
    }
    return { observations }
})
define("enabling reduced motion cancels an in-flight oldest-boundary animation immediately", async f => {
    await atOldestBoundary(f)
    assert(f.pane.getAnimations().length === 1, "Fixture lacks a boundary animation")
    f.reduction.matches = true
    f.reduction.dispatchEvent(new Event("change"))
    assert(!f.pane.getAnimations().length && !f.layer.getAnimations().length, "Reduced motion retained an active animation")
    await completelySettled(f)
    f.stableFrame(844)
    near(f.geometry().footerBottom, 844, "Reduced motion changed composer endpoint")
    near(f.pane.scrollTop, 0, "Reduced motion changed oldest-history position")
    return { animations: 0, finalPadding: getComputedStyle(f.pane).paddingTop }
})
define("closing during native scrolling near latest prevents browser max-scroll clamping before paint", async f => {
    f.move(524); await f.finish(); await f.settled()
    const nativeTop = f.pane.scrollHeight - f.pane.clientHeight - 1
    f.touch("touchstart"); f.nativeScroll(nativeTop); f.writes.length = 0
    const before = f.geometry()
    f.move(844)
    near(f.pane.scrollTop, nativeTop, "Expanding the pane clamped native scroll before reserving content")
    await sampleShared(f, 844, before)
    await f.finish()
    assert(f.writes.length === 0, "Near-latest closing wrote scroll while finger remained down")
    f.touch("touchend")
    await completelySettled(f)
    const after = f.stableFrame(844)
    near(after.scroll, after.max, "Near-latest closing failed to settle at latest")
    near(after.gap, before.gap, "Near-latest closing detached newest message at settlement")
    return { nativeTop, finalScroll: after.scroll, gap: after.gap }
})
define("an origin-only viewport event during native scrolling releases its measurement hold when idle", async f => {
    f.move(524); await f.finish(); await f.settled()
    await f.history(900)
    f.touch("touchstart"); f.nativeScroll(880); f.writes.length = 0
    const before = f.geometry(f.rows[24])
    f.move(524, 80)
    f.stableFrame(524, 80)
    assert(!f.layer.getAnimations().length, "Origin-only event created keyboard displacement motion")
    near(f.geometry(f.rows[24]).marker - before.marker, 80, "Origin-only event changed content relative to root")
    near(f.pane.scrollTop, 880, "Origin-only event changed native scroll")
    assert(f.writes.length === 0, "Origin-only event wrote scroll during native ownership")
    f.touch("touchend")
    await completelySettled(f)
    f.stableFrame(524, 80)
    near(f.pane.scrollTop, 880, "Origin-only cleanup replayed an unnecessary correction")
    assert(!f.layer.style.height && !f.pane.style.paddingTop, "Origin-only event stranded measurement geometry")
    return { origin: 80, scroll: f.pane.scrollTop, measurementRetired: true }
})

const results = []
for (const item of cases) {
    let f
    try { f = await fixture(item.options); results.push({ name: item.name, passed: true, observations: await item.action(f) }) }
    catch (error) { results.push({ name: item.name, passed: false, error: String(error?.message ?? error) }) }
    finally { await f?.close() }
    document.querySelector("#result").textContent = JSON.stringify({ status: "running", cases: results }, null, 2)
}
const report = { status: "complete", total: cases.length, passed: results.filter(item => item.passed).length, cases: results, userAgent: navigator.userAgent, limits: "Real motion and message-layout observers with synthetic DOM, geometry and touch/scroll events. WAAPI is sampled at deterministic timeline positions. No account, read hook, provider, native keyboard or physical-device claim." }
window.mobileConversationMotionFixtureResult = report
document.querySelector("#result").textContent = JSON.stringify(report, null, 2)
