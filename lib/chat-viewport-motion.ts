// The host owns keyboard geometry. A visible chat may animate that geometry
// without resizing its iframe (and reflowing its messages) on every frame.
export const CHAT_VIEWPORT_MOTION_EVENT = "betelgeze:chat-viewport-motion"
export const CHAT_LAYOUT_WILL_CHANGE_EVENT = "conversation-layout-will-change"
export const CHAT_LAYOUT_COMMIT_EVENT = "conversation-layout-commit"
export const CHAT_KEYBOARD_EASING = "cubic-bezier(0.32, 0.72, 0, 1)"

type MotionRequest = {
    scope: HTMLElement
    from: number
    bottom: number
    duration: number
    apply: (bottom: number) => void
    handled: boolean
}

export function requestChatViewportMotion(scope: HTMLElement, from: number, bottom: number, duration: number, apply: (bottom: number) => void) {
    const detail: MotionRequest = { scope, from, bottom, duration, apply, handled: false }
    scope.ownerDocument.defaultView?.dispatchEvent(new CustomEvent(CHAT_VIEWPORT_MOTION_EVENT, { detail }))
    if (!detail.handled) apply(bottom)
}

export function observeChatViewportMotion(clip: HTMLElement, layer: HTMLElement) {
    const view = clip.ownerDocument.defaultView!
    const host = view.parent === view ? view : view.parent
    const mobile = host.matchMedia("(max-width: 1023px)")
    const reducedMotion = host.matchMedia("(prefers-reduced-motion: reduce)")
    let animation: Animation | null = null
    let pending: MotionRequest | null = null
    let touching = false
    let interacting = false
    let settleTimer = 0
    let finishTimer = 0
    let finishOverdue = false

    const captureLayout = () => {
        layer.querySelector("[data-message-pane]")?.dispatchEvent(new Event(CHAT_LAYOUT_WILL_CHANGE_EVENT))
    }
    const commitLayout = () => {
        layer.querySelector("[data-message-pane]")?.dispatchEvent(new Event(CHAT_LAYOUT_COMMIT_EVENT))
    }
    const surface = host === view ? clip : view.frameElement
    const visible = () => surface && surface.getBoundingClientRect().height > 0 && clip.getBoundingClientRect().height > 0
    function release() {
        view.clearTimeout(finishTimer)
        finishTimer = 0
        finishOverdue = false
        pending = null
        layer.style.height = ""
        animation?.cancel()
        animation = null
        layer.style.willChange = ""
        delete clip.dataset.chatViewportMoving
    }
    function finish() {
        if (!pending) return
        if (!visible()) { release(); return }
        const request = pending
        pending = null
        // The transform and final scroll compensation disappear in the same
        // task, before paint. No resize-observer round trip across the iframe.
        captureLayout()
        request.apply(request.bottom)
        release()
        commitLayout()
    }
    function settle() {
        view.clearTimeout(settleTimer)
        if (touching) return
        settleTimer = view.setTimeout(() => {
            interacting = false
            if (animation?.playState === "finished" || finishOverdue) finish()
        }, 220)
    }
    function onTouchStart(event: TouchEvent) {
        if (!(event.target as HTMLElement | null)?.closest("[data-message-pane]")) return
        touching = interacting = true
        view.clearTimeout(settleTimer)
    }
    function onTouchEnd(event: TouchEvent) { touching = event.touches.length > 0; settle() }
    function onScroll() { if (interacting) settle() }
    function onWheel() { interacting = true; settle() }

    function onMotion(event: Event) {
        const request = (event as CustomEvent<MotionRequest>).detail
        if (request.handled || !surface || !request.scope.contains(surface) || !visible()) {
            // Hidden resident iframes can still report their old inner viewport
            // size. Check the host frame too, and retire its previous request.
            if (pending?.scope === request.scope) release()
            return
        }
        request.handled = true
        const animate = mobile.matches && !reducedMotion.matches && request.duration > 0 && typeof layer.animate === "function"
        if (!animate) {
            pending = request
            finish()
            return
        }
        // Keep enough real layout for both endpoints. Opening translates the
        // existing tall layer upward; closing expands it once before moving.
        // The stationary clip keeps messages underneath the chat header hidden.
        const previousBottom = layer.getBoundingClientRect().bottom
        captureLayout()
        view.clearTimeout(finishTimer)
        finishOverdue = false
        animation?.cancel()
        const layoutBottom = Math.max(request.from, request.bottom)
        request.apply(layoutBottom)
        layer.style.height = `${clip.clientHeight}px`
        commitLayout()
        const from = previousBottom - layer.getBoundingClientRect().bottom
        const to = request.bottom - layoutBottom
        pending = request
        if (Math.abs(from - to) < 0.5) { finish(); return }
        clip.dataset.chatViewportMoving = "true"
        layer.style.willChange = "transform"
        animation = layer.animate([
            { transform: `translate3d(0, ${from}px, 0)` },
            { transform: `translate3d(0, ${to}px, 0)` },
        ], { duration: request.duration, easing: CHAT_KEYBOARD_EASING, fill: "both" })
        const currentAnimation = animation
        animation.onfinish = () => {
            // Resizing a native scroller during momentum can cancel the fling.
            // Retain the endpoint transform until that gesture has settled.
            if (animation === currentAnimation && !interacting) finish()
        }
        // WebKit may suspend an animation without delivering its finish event.
        // Resolve to real layout once movement has had time to finish, while
        // still allowing an active message scroll to reach its normal end.
        finishTimer = view.setTimeout(() => {
            if (animation !== currentAnimation || pending !== request) return
            finishTimer = 0
            finishOverdue = true
            if (!interacting) finish()
        }, request.duration + 400)
    }
    function resetInteraction() {
        touching = interacting = false
        view.clearTimeout(settleTimer)
        finish()
    }
    function onVisibility() { resetInteraction() }
    function onReducedMotion() { if (reducedMotion.matches) finish() }
    host.addEventListener(CHAT_VIEWPORT_MOTION_EVENT, onMotion)
    clip.addEventListener("touchstart", onTouchStart, { passive: true })
    clip.addEventListener("touchend", onTouchEnd, { passive: true })
    clip.addEventListener("touchcancel", onTouchEnd, { passive: true })
    clip.addEventListener("wheel", onWheel, { passive: true })
    clip.addEventListener("scroll", onScroll, true)
    clip.ownerDocument.addEventListener("visibilitychange", onVisibility)
    host.addEventListener("pagehide", resetInteraction)
    host.addEventListener("pageshow", resetInteraction)
    reducedMotion.addEventListener("change", onReducedMotion)
    return () => {
        finish()
        view.clearTimeout(settleTimer)
        host.removeEventListener(CHAT_VIEWPORT_MOTION_EVENT, onMotion)
        clip.removeEventListener("touchstart", onTouchStart)
        clip.removeEventListener("touchend", onTouchEnd)
        clip.removeEventListener("touchcancel", onTouchEnd)
        clip.removeEventListener("wheel", onWheel)
        clip.removeEventListener("scroll", onScroll, true)
        clip.ownerDocument.removeEventListener("visibilitychange", onVisibility)
        host.removeEventListener("pagehide", resetInteraction)
        host.removeEventListener("pageshow", resetInteraction)
        reducedMotion.removeEventListener("change", onReducedMotion)
    }
}
