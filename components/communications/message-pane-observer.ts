import type { MutableRefObject } from "react"

// Store content coordinates so an unreported native scroll cannot look like
// a layout shift. Touch scrolling may run ahead of main-thread scroll events.
type Anchor = { element: HTMLElement; top: number }
const SCROLL_SETTLE_MS = 200

export function observeConversationLayout(
    pane: HTMLDivElement,
    followLatest: MutableRefObject<boolean>,
    onPosition: (atLatest: boolean, away: boolean) => void,
) {
    const view = pane.ownerDocument.defaultView!
    let height = 0
    let contentHeight = 0
    let scrollTop = pane.scrollTop
    let anchor: Anchor | null = null
    let hidden = false
    let touching = false
    let interacting = false
    let scrolled = false
    let frame = 0
    let settleTimer = 0
    let lastPosition = ""
    const content = pane.firstElementChild

    function publish() {
        const distance = pane.scrollHeight - pane.clientHeight - pane.scrollTop
        const latest = distance <= 24, away = distance > 96
        const position = `${latest}:${away}`
        if (position !== lastPosition) {
            lastPosition = position
            onPosition(latest, away)
        }
    }

    function captureAnchor() {
        const bounds = pane.getBoundingClientRect()
        const rows = pane.querySelectorAll<HTMLElement>("[data-message-scroll-anchor]")
        let low = 0, high = rows.length
        while (low < high) {
            const middle = (low + high) >>> 1
            if (rows[middle].getBoundingClientRect().bottom <= bounds.top) low = middle + 1
            else high = middle
        }
        const element = rows[low]
        anchor = element ? { element, top: element.getBoundingClientRect().top - bounds.top + pane.scrollTop } : null
    }

    function remember(capture = true) {
        if (pane.clientHeight <= 0) return
        height = pane.clientHeight
        contentHeight = pane.scrollHeight
        scrollTop = pane.scrollTop
        if (capture) {
            if (!followLatest.current) captureAnchor()
            else anchor = null
        }
        publish()
    }

    function restore(force = false, geometryCommit = false) {
        const nextHeight = pane.clientHeight
        if (nextHeight <= 0) {
            hidden = true
            touching = interacting = false
            view.clearTimeout(settleTimer)
            return
        }
        // Never write a scroll position during a gesture or its momentum.
        // Accept the current layout; settling must not replay an old correction.
        if (interacting) { remember(false); return }
        if (!force && !hidden && nextHeight === height && pane.scrollHeight === contentHeight) return
        let nextTop = hidden || geometryCommit ? scrollTop : pane.scrollTop
        if (followLatest.current) nextTop = pane.scrollHeight - nextHeight
        else if (anchor?.element.isConnected && pane.contains(anchor.element)) {
            const top = anchor.element.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop
            nextTop += top - anchor.top + (height ? height - nextHeight : 0)
        } else if (height) nextTop += height - nextHeight
        hidden = false
        nextTop = Math.max(0, Math.min(pane.scrollHeight - nextHeight, nextTop))
        if (Math.abs(pane.scrollTop - nextTop) > 0.5 || pane.scrollLeft) pane.scrollTo({ top: nextTop, left: 0, behavior: "instant" })
        pane.dataset.positioned = "true"
        remember()
    }

    function scheduleSettle() {
        view.clearTimeout(settleTimer)
        if (touching) return
        settleTimer = view.setTimeout(() => {
            interacting = false
            // A tap may have paused bottom-following while content arrived.
            // A scroll, including inertia, always establishes a fresh position.
            if (!scrolled) restore(true)
            else remember()
        }, SCROLL_SETTLE_MS)
    }

    function beginInteraction() {
        if (!interacting) scrolled = false
        interacting = true
        scheduleSettle()
    }
    function onTouchStart() { touching = true; beginInteraction() }
    function onTouchEnd(event: TouchEvent) {
        touching = event.touches.length > 0
        scheduleSettle()
    }
    function onWheel(event: WheelEvent) {
        beginInteraction()
        if (event.deltaY < 0) followLatest.current = false
    }
    function onKeyDown(event: KeyboardEvent) {
        if (event.target instanceof Element && event.target.closest("input,textarea,video,audio,button,[role='slider']")) return
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
            beginInteraction()
            if (["ArrowUp", "PageUp", "Home"].includes(event.key)) followLatest.current = false
        }
    }
    function onPointerDown(event: PointerEvent) {
        // Native scrollbar drags have no wheel/touch events.
        if (event.pointerType === "mouse" && event.clientX - pane.getBoundingClientRect().left >= pane.clientWidth) beginInteraction()
    }
    function onScroll() {
        if (pane.clientHeight <= 0) return
        if (interacting) {
            scrolled = true
            followLatest.current = pane.scrollHeight - pane.clientHeight - pane.scrollTop <= 24
            scheduleSettle()
        } else if (pane.clientHeight !== height || pane.scrollHeight !== contentHeight) {
            restore()
        }
        if (!frame) frame = view.requestAnimationFrame(() => {
            frame = 0
            // Avoid message queries/bounds reads on every touch-scroll frame.
            if (interacting) publish()
            else remember()
        })
    }
    function onResize() { restore() }
    function onLayoutCommit() {
        // A stationary tap can close the keyboard before touchend. Permit the
        // atomic geometry correction, while leaving real drags/inertia alone.
        const wasInteracting = interacting
        if (!scrolled) interacting = false
        restore(false, true)
        interacting = wasInteracting
    }
    function onLayoutWillChange() { remember() }
    function onVisible() { restore(true) }
    const observer = new ResizeObserver(onResize)
    observer.observe(pane)
    if (content) observer.observe(content)
    pane.addEventListener("scroll", onScroll, { passive: true })
    pane.addEventListener("touchstart", onTouchStart, { passive: true })
    pane.addEventListener("touchend", onTouchEnd, { passive: true })
    pane.addEventListener("touchcancel", onTouchEnd, { passive: true })
    pane.addEventListener("wheel", onWheel, { passive: true })
    pane.addEventListener("keydown", onKeyDown)
    pane.addEventListener("pointerdown", onPointerDown, { passive: true })
    pane.addEventListener("conversation-visible", onVisible)
    pane.addEventListener("conversation-layout-will-change", onLayoutWillChange)
    pane.addEventListener("conversation-layout-commit", onLayoutCommit)
    restore(true)
    return () => {
        observer.disconnect()
        view.cancelAnimationFrame(frame)
        view.clearTimeout(settleTimer)
        pane.removeEventListener("scroll", onScroll)
        pane.removeEventListener("touchstart", onTouchStart)
        pane.removeEventListener("touchend", onTouchEnd)
        pane.removeEventListener("touchcancel", onTouchEnd)
        pane.removeEventListener("wheel", onWheel)
        pane.removeEventListener("keydown", onKeyDown)
        pane.removeEventListener("pointerdown", onPointerDown)
        pane.removeEventListener("conversation-visible", onVisible)
        pane.removeEventListener("conversation-layout-will-change", onLayoutWillChange)
        pane.removeEventListener("conversation-layout-commit", onLayoutCommit)
    }
}
