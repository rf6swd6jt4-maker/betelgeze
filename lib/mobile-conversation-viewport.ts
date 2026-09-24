export const MOBILE_CONVERSATION_VISIBILITY_EVENT = "betelgeze:mobile-conversation-visibility"
export type MobileConversationPhase = "entering" | "open" | "dismissing-keyboard" | "leaving"

/** The conversation is absolute in the initial containing block, not fixed to
 * WebKit's independently moving layout viewport. pageTop already includes the
 * document pan; adding scrollY or offsetTop would apply that pan a second time.
 */
export function mobileConversationBounds(view: Pick<Window, "visualViewport" | "innerHeight" | "scrollY">) {
    const viewport = view.visualViewport
    const top = viewport ? viewport.pageTop : view.scrollY
    const height = viewport ? viewport.height : view.innerHeight
    const scale = viewport ? viewport.scale : 1
    if (![top, height, scale].every(Number.isFinite) || top < 0 || height <= 0 || Math.abs(scale - 1) >= 0.01) return null
    return { top, height }
}

export function mobileConversationIsOpen(view: Window) {
    return view.document.documentElement.dataset.mobileConversationOpen === "true"
}

/** A body-level conversation owns geometry while the resident list is covered.
 * The shell keeps its last resting bounds; it must suspend all its controllers.
 */
export function ownMobileConversation(view: Window, phase: MobileConversationPhase) {
    const html = view.document.documentElement
    const previousOpen = html.getAttribute("data-mobile-conversation-open")
    const previousPhase = html.getAttribute("data-mobile-conversation-phase")
    const background = [...view.document.querySelectorAll<HTMLElement>("[data-workspace-topbar], [data-workspace-tabbar], [data-workspace-tab-panels]")]
        .map(element => ({ element, inert: element.inert, ariaHidden: element.getAttribute("aria-hidden") }))
    const publish = () => view.dispatchEvent(new Event(MOBILE_CONVERSATION_VISIBILITY_EVENT))
    html.dataset.mobileConversationOpen = "true"
    html.dataset.mobileConversationPhase = phase
    background.forEach(({ element }) => { element.inert = true; element.setAttribute("aria-hidden", "true") })
    publish()
    let released = false
    return {
        phase(next: MobileConversationPhase) { if (!released) html.dataset.mobileConversationPhase = next },
        release() {
            if (released) return
            released = true
            if (previousOpen === null) html.removeAttribute("data-mobile-conversation-open")
            else html.setAttribute("data-mobile-conversation-open", previousOpen)
            if (previousPhase === null) html.removeAttribute("data-mobile-conversation-phase")
            else html.setAttribute("data-mobile-conversation-phase", previousPhase)
            background.forEach(({ element, inert, ariaHidden }) => {
                element.inert = inert
                if (ariaHidden === null) element.removeAttribute("aria-hidden")
                else element.setAttribute("aria-hidden", ariaHidden)
            })
            // Synchronous restoration before the outgoing surface disappears.
            publish()
        },
    }
}

/** One document-coordinate frame for the header, messages and composer. No
 * workspace offsets, fixed-layer correction, animation prediction or scroll reset.
 */
export function observeMobileConversationViewport(view: Window, root: HTMLElement) {
    let frame = 0, disposed = false, previous = ""
    function measure() {
        if (disposed || view.document.visibilityState === "hidden") return
        const bounds = mobileConversationBounds(view)
        if (!bounds) return
        const signature = `${bounds.top}:${bounds.height}`
        if (signature === previous) return
        const panes = [...root.querySelectorAll<HTMLElement>("[data-message-pane]")]
        panes.forEach(pane => pane.dispatchEvent(new Event("conversation-layout-will-change")))
        root.style.setProperty("--conversation-viewport-top", `${bounds.top}px`)
        root.style.setProperty("--conversation-viewport-height", `${bounds.height}px`)
        previous = signature
        panes.forEach(pane => pane.dispatchEvent(new Event("conversation-layout-commit")))
    }
    function update() {
        if (frame) view.cancelAnimationFrame(frame)
        frame = 0
        measure()
        if (!disposed && view.document.visibilityState !== "hidden") frame = view.requestAnimationFrame(() => { frame = 0; measure() })
    }
    const viewport = view.visualViewport
    viewport?.addEventListener("resize", update)
    viewport?.addEventListener("scroll", update)
    viewport?.addEventListener("scrollend", update)
    // pageTop can change while offsetTop stays constant. In that case WebKit
    // sends a document scroll, without a visual-viewport scroll event.
    view.addEventListener("scroll", update, { passive: true })
    view.addEventListener("scrollend", update)
    view.addEventListener("resize", update)
    view.addEventListener("pageshow", update)
    view.document.addEventListener("visibilitychange", update)
    update()
    return () => {
        disposed = true
        view.cancelAnimationFrame(frame)
        viewport?.removeEventListener("resize", update)
        viewport?.removeEventListener("scroll", update)
        viewport?.removeEventListener("scrollend", update)
        view.removeEventListener("scroll", update)
        view.removeEventListener("scrollend", update)
        view.removeEventListener("resize", update)
        view.removeEventListener("pageshow", update)
        view.document.removeEventListener("visibilitychange", update)
        root.style.removeProperty("--conversation-viewport-top")
        root.style.removeProperty("--conversation-viewport-height")
    }
}
