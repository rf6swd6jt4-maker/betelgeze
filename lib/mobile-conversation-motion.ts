// Presentation only. The conversation viewport remains the sole geometry owner;
// focus, its document-coordinate origin and the header never enter this layer.
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { CHAT_LAYOUT_WILL_CHANGE_EVENT, CHAT_LAYOUT_COMMIT_EVENT } from "./chat-viewport-motion.ts"
// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { CONVERSATION_CURVE, continueConversationCurve, conversationCurveVelocity, conversationEasing, type ConversationCurve } from "./mobile-conversation-easing.ts"

export const MOBILE_CONVERSATION_MOTION_MS = 260

export function observeMobileConversationMotion(clip: HTMLElement, layer: HTMLElement) {
    const view = clip.ownerDocument.defaultView!
    const reduced = view.matchMedia("(prefers-reduced-motion: reduce)")
    const surface = clip.closest<HTMLElement>("[data-mobile-conversation-surface]")
    let animation: Animation | null = null
    let moving = layer
    let before: { height: number; paneHeight: number; bottom: number } | null = null
    let deadline = 0, timer = 0, settleTimer = 0
    let touching = false, interacting = false, scrolled = false, committing = false
    let direction = 0, overdue = false
    let inset: { pane: HTMLElement; original: string; base: number; added: number } | null = null
    let boundary: Animation | null = null
    let measurementHold = false
    let curve: ConversationCurve = CONVERSATION_CURVE
    let motionDistance = 0, motionDuration = 0
    let layoutWidth = clip.clientWidth, widthChangedAt = -Infinity
    const pane = () => layer.querySelector<HTMLElement>("[data-message-pane]")
    const motionTarget = () => pane()?.dataset.empty === "true" ? layer.querySelector<HTMLElement>("[data-composer-slot]") ?? layer : layer
    const visible = () => surface && !surface.hidden && !surface.inert && surface.dataset.phase === "open"
        && view.document.visibilityState !== "hidden" && clip.clientHeight > 0

    function layoutEvent(name: string) { pane()?.dispatchEvent(new Event(name)) }
    function absorbBoundary(capture: boolean) {
        if (!boundary) return
        const messagePane = pane()
        if (messagePane) {
            const offset = new DOMMatrixReadOnly(view.getComputedStyle(messagePane).transform).m42
            if (offset > 0.5) {
                inset ??= { pane: messagePane, original: messagePane.style.paddingTop, base: parseFloat(view.getComputedStyle(messagePane).paddingTop) || 0, added: 0 }
                inset.added += offset
                messagePane.style.paddingTop = `${inset.base + inset.added}px`
                overdue = true
            }
        }
        boundary.cancel()
        boundary = null
        if (capture) {
            committing = true
            layoutEvent(CHAT_LAYOUT_WILL_CHANGE_EVENT)
            committing = false
        }
    }
    function clear() {
        view.clearTimeout(timer)
        timer = 0
        animation?.cancel()
        animation = null
        moving.style.willChange = ""
        layer.style.height = ""
        layer.style.willChange = ""
        if (inset) { inset.pane.style.paddingTop = inset.original; inset = null }
        delete clip.dataset.chatViewportMoving
        deadline = 0
        direction = 0
        overdue = false
        measurementHold = false
        motionDistance = motionDuration = 0
    }
    function finish(immediate = false) {
        if (!animation && !inset && !measurementHold) return
        if (!immediate && interacting && visible()) {
            animation?.finish()
            overdue = true
            return
        }
        committing = true
        const messagePane = pane()
        const stack = messagePane?.firstElementChild
        const paintedTop = inset && stack ? stack.getBoundingClientRect().top : null
        // The existing scroll owner transfers the endpoint transform into real
        // layout once native scrolling is idle, in the same task before paint.
        layoutEvent(CHAT_LAYOUT_WILL_CHANGE_EVENT)
        clear()
        layoutEvent(CHAT_LAYOUT_COMMIT_EVENT)
        committing = false
        // At the oldest-message boundary there may be less scroll available
        // than the inset. Its remaining blank space retires visually instead
        // of asking the native scroller for an impossible negative position.
        if (!immediate && paintedTop !== null && stack && messagePane && visible() && !reduced.matches) {
            const remainder = paintedTop - stack.getBoundingClientRect().top
            if (remainder > 0.5) {
                boundary?.cancel()
                boundary = messagePane.animate([
                    { transform: `translate3d(0, ${remainder}px, 0)` },
                    { transform: "translate3d(0, 0, 0)" },
                ], { duration: 160, easing: conversationEasing(CONVERSATION_CURVE) })
                const current = boundary
                boundary.onfinish = () => { if (boundary === current) { boundary.cancel(); boundary = null } }
            }
        }
    }
    function retire() {
        touching = interacting = scrolled = false
        view.clearTimeout(settleTimer)
        settleTimer = 0
        before = null
        finish()
        boundary?.cancel()
        boundary = null
    }
    function settle() {
        view.clearTimeout(settleTimer)
        if (touching) return
        // The scroll owner settles at 200ms; commit after it releases the fling.
        settleTimer = view.setTimeout(() => {
            interacting = false
            if (animation?.playState === "finished" || overdue || inset) finish()
        }, 220)
    }
    function onTouchStart(event: Event) {
        if (!(event.target as Element | null)?.closest("[data-message-pane]")) return
        if (!interacting) scrolled = false
        touching = interacting = true
        view.clearTimeout(settleTimer)
        absorbBoundary(true)
    }
    function onTouchEnd(event: TouchEvent) { touching = event.touches.length > 0; settle() }
    function onScroll() { if (interacting) { scrolled = true; settle() } }
    function onWheel() {
        if (!interacting) scrolled = false
        interacting = true
        absorbBoundary(true)
        settle()
    }
    function reconcileWidth() {
        const width = clip.clientWidth
        if (width <= 0 || width === layoutWidth) return
        layoutWidth = width
        widthChangedAt = view.performance.now()
        // Rotation rewraps messages and the draft. Retire old-width cosmetics;
        // the existing layout owner handles the new natural geometry and keeps
        // native scrolling ownership. No focus or viewport values are changed.
        boundary?.cancel()
        boundary = null
        finish(true)
    }
    function onWillChange() {
        if (committing) return
        if (!visible()) { retire(); return }
        reconcileWidth()
        absorbBoundary(false)
        // An empty prompt is top-aligned, unlike bottom-anchored messages. Keep
        // its natural pane still and animate only the composer until a row exists.
        // Reuse the same timing/retargeting owner, without a second animation.
        if (!animation) moving = motionTarget()
        before = { height: clip.clientHeight, paneHeight: pane()?.clientHeight ?? 0, bottom: moving.getBoundingClientRect().bottom }
        if (moving === layer && !animation && interacting && scrolled && view.performance.now() - widthChangedAt > 48
            && !reduced.matches && !view.document.querySelector("[data-anchored-popup]")) {
            // Keep native maxScroll from shrinking before commit can install
            // its matching content inset (notably while scrolling near latest).
            layer.style.height = `${layer.clientHeight}px`
            measurementHold = true
        }
    }
    function onCommit() {
        if (committing || !before) return
        const previous = before
        before = null
        const height = clip.clientHeight
        if (Math.abs(height - previous.height) < 0.5) {
            if (!animation && (inset || measurementHold)) finish()
            return
        }
        // Fixed portal popups follow layout/scroll events, not compositor motion.
        // Keep their existing anchor contract, and honor reduced-motion settings.
        if (!visible()) { retire(); return }
        const animate = !reduced.matches && typeof layer.animate === "function"
            && view.performance.now() - widthChangedAt > 48
            && !view.document.querySelector("[data-anchored-popup]")
        if (!animate && (!animation || !interacting)) { finish(); return }
        const now = view.performance.now()
        const nextDirection = Math.sign(height - previous.height)
        // One-pixel rounding oscillations are endpoint corrections, not new
        // keyboard gestures. They must not repeatedly restart the motion clock.
        const reversing = animation && nextDirection !== direction && Math.abs(height - previous.height) > 2
        const continuing = animation && !reversing && deadline > now
        const duration = !animate ? 0 : continuing ? deadline - now : MOBILE_CONVERSATION_MOTION_MS
        const time = typeof animation?.currentTime === "number" ? animation.currentTime : 0
        const velocity = animation && motionDuration > 0 ? motionDistance / motionDuration * conversationCurveVelocity(curve, time / motionDuration) : 0
        const oldLayerHeight = layer.clientHeight
        const shared = moving === layer
        const retainedHeight = shared ? Math.max(oldLayerHeight, previous.height, height) : height
        view.clearTimeout(timer)
        animation?.cancel()
        const messagePane = pane()
        const reserve = shared && interacting && scrolled ? Math.max(0, retainedHeight - oldLayerHeight) : 0
        if (messagePane && reserve > 0.5) {
            inset ??= { pane: messagePane, original: messagePane.style.paddingTop, base: parseFloat(view.getComputedStyle(messagePane).paddingTop) || 0, added: 0 }
            inset.added += reserve
            messagePane.style.paddingTop = `${inset.base + inset.added}px`
            // WebKit otherwise clamps the native scroll offset while laying
            // out the taller parent, before it installs the child's new extent.
            // Commit that extent first, once at this gesture/geometry handoff.
            void messagePane.scrollHeight
        }
        if (shared) layer.style.height = `${retainedHeight}px`
        const growth = messagePane ? messagePane.clientHeight - previous.paneHeight : 0
        if (shared && messagePane && interacting && scrolled && (growth > 0.5 || reserve > 0.5)) {
            inset ??= { pane: messagePane, original: messagePane.style.paddingTop, base: parseFloat(view.getComputedStyle(messagePane).paddingTop) || 0, added: 0 }
            inset.added += growth - reserve
            messagePane.style.paddingTop = `${inset.base + inset.added}px`
        }
        moving.style.willChange = "transform"
        const from = previous.bottom - moving.getBoundingClientRect().bottom
        const to = shared ? height - retainedHeight : 0
        if (!direction || Math.abs(height - previous.height) > 2) direction = nextDirection
        overdue = false
        deadline = now + duration
        curve = continuing ? continueConversationCurve(velocity, to - from, duration) : CONVERSATION_CURVE
        motionDistance = to - from
        motionDuration = duration
        clip.dataset.chatViewportMoving = "true"
        animation = moving.animate([
            { transform: `translate3d(0, ${from}px, 0)` },
            { transform: `translate3d(0, ${to}px, 0)` },
        ], { duration, easing: conversationEasing(curve), fill: "both" })
        const current = animation
        animation.onfinish = () => { if (animation === current && !interacting) finish() }
        timer = view.setTimeout(() => {
            if (animation !== current) return
            overdue = true
            // A suspended finish callback must not strand temporary geometry.
            if (!interacting) finish()
        }, duration + 400)
    }
    function onPopup() {
        if (committing) return
        before = null
        boundary?.cancel()
        boundary = null
        // The popup measures immediately after this event. Retire cosmetic
        // geometry even during a hold; the scroll owner's gesture guard stays.
        finish(true)
    }
    function onReduced() {
        if (!reduced.matches) return
        boundary?.cancel()
        boundary = null
        finish()
    }
    const lifecycle = new MutationObserver(() => { if (!visible()) retire() })
    if (surface) lifecycle.observe(surface, { attributes: true, attributeFilter: ["hidden", "inert", "data-phase"] })
    // A newly inserted message must use settled geometry before the existing
    // two-frame visibility/read check. End cosmetic motion rather than changing
    // that protected predicate or manufacturing interaction/read events.
    const messages = new MutationObserver(() => {
        const target = motionTarget()
        if (target !== moving) {
            boundary?.cancel()
            boundary = null
            finish(true)
            moving = target
            before = null
        }
        if (interacting) return
        boundary?.cancel()
        boundary = null
        finish()
    })
    const stack = pane()?.firstElementChild
    if (stack) messages.observe(stack, { childList: true })
    const sizing = new ResizeObserver(reconcileWidth)
    sizing.observe(clip)
    // Capture reaches the pane's non-bubbling notifications before its existing
    // anchoring listener. Never replace that listener or add a second scroll owner.
    clip.addEventListener(CHAT_LAYOUT_WILL_CHANGE_EVENT, onWillChange, true)
    clip.addEventListener(CHAT_LAYOUT_COMMIT_EVENT, onCommit, true)
    clip.addEventListener("betelgeze:anchored-popup-opening", onPopup, true)
    clip.addEventListener("touchstart", onTouchStart, { passive: true })
    clip.addEventListener("touchend", onTouchEnd, { passive: true })
    clip.addEventListener("touchcancel", onTouchEnd, { passive: true })
    clip.addEventListener("wheel", onWheel, { passive: true })
    clip.addEventListener("scroll", onScroll, true)
    view.document.addEventListener("visibilitychange", retire)
    view.addEventListener("pagehide", retire)
    reduced.addEventListener("change", onReduced)
    return () => {
        retire()
        lifecycle.disconnect()
        messages.disconnect()
        sizing.disconnect()
        clip.removeEventListener(CHAT_LAYOUT_WILL_CHANGE_EVENT, onWillChange, true)
        clip.removeEventListener(CHAT_LAYOUT_COMMIT_EVENT, onCommit, true)
        clip.removeEventListener("betelgeze:anchored-popup-opening", onPopup, true)
        clip.removeEventListener("touchstart", onTouchStart)
        clip.removeEventListener("touchend", onTouchEnd)
        clip.removeEventListener("touchcancel", onTouchEnd)
        clip.removeEventListener("wheel", onWheel)
        clip.removeEventListener("scroll", onScroll, true)
        view.document.removeEventListener("visibilitychange", retire)
        view.removeEventListener("pagehide", retire)
        reduced.removeEventListener("change", onReduced)
    }
}
