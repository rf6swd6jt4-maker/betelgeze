"use client"

import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { observeMobileConversationViewport, ownMobileConversation, type MobileConversationPhase } from "@/lib/mobile-conversation-viewport"

const subscribeMobile = (notify: () => void) => {
    const query = window.matchMedia("(max-width: 1023px)")
    query.addEventListener("change", notify)
    return () => query.removeEventListener("change", notify)
}
const mobileSnapshot = () => window.parent === window && window.matchMedia("(max-width: 1023px)").matches
const serverMobileSnapshot = () => false

/** Keep one React portal target for the lifetime of this workspace. Moving the
 * target between the desktop grid and body does not remount the draft/editor.
 */
export function MobileConversationSurface({ selected, active, onClose, children }: {
    selected: boolean
    active: boolean
    onClose: () => void
    children: ReactNode
}) {
    const anchor = useRef<HTMLDivElement | null>(null)
    const targetRef = useRef<HTMLDivElement | null>(null)
    const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null)
    const mobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, serverMobileSnapshot)
    const close = useRef<(() => void) | null>(null)
    const current = useRef({ onClose, selected })
    useLayoutEffect(() => { current.current = { onClose, selected } }, [onClose, selected])
    const attach = useCallback((element: HTMLDivElement | null) => {
        anchor.current = element
        if (!element) return
        const node = document.createElement("div")
        node.className = "contents"
        targetRef.current = node
        element.append(node)
        setPortalTarget(node)
        return () => { node.remove(); targetRef.current = null; anchor.current = null }
    }, [])

    useLayoutEffect(() => {
        const target = targetRef.current
        if (!target) return
        if (!mobile) {
            if (anchor.current && target.parentElement !== anchor.current) anchor.current.append(target)
            target.className = "contents"
            target.hidden = false
            target.inert = false
            target.removeAttribute("aria-hidden")
            delete target.dataset.mobileConversationSurface
            delete target.dataset.phase
            close.current = null
            return
        }
        if (target.parentElement !== document.body) document.body.append(target)
        target.className = "mobile-conversation-surface"
        target.dataset.mobileConversationSurface = "true"
        target.hidden = !active || !selected
        target.inert = !active || !selected
        target.setAttribute("aria-hidden", !active || !selected ? "true" : "false")
        if (!active || !selected) return

        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        if (previousFocus?.matches("input, textarea, [contenteditable=true]")) previousFocus.blur()
        let disposed = false, navigation: Animation | null = null, waitTimer = 0, waitFrame = 0
        let phase: MobileConversationPhase = "entering"
        const ownership = ownMobileConversation(window, phase)
        const stopViewport = observeMobileConversationViewport(window, target)
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
        const setPhase = (next: MobileConversationPhase) => {
            phase = next
            target.dataset.phase = next
            ownership.phase(next)
        }
        const cancelNavigation = () => {
            const previous = navigation
            navigation = null
            previous?.cancel()
            target.style.willChange = ""
        }
        const presented = () => {
            if (disposed) return
            cancelNavigation()
            target.style.transform = "none"
            target.inert = false
            setPhase("open")
        }
        const animate = (leaving: boolean, finished: () => void) => {
            // A Back/navigation interruption must continue from the currently
            // painted position, including an entrance whose finish is queued.
            const painted = navigation ? window.getComputedStyle(target).transform : null
            cancelNavigation()
            const from = painted ?? (leaving ? "translateX(0)" : "translateX(100%)")
            const to = leaving ? "translateX(100%)" : "translateX(0)"
            target.style.transform = from
            if (reduced.matches || typeof target.animate !== "function") { finished(); return }
            target.style.willChange = "transform"
            navigation = target.animate([{ transform: from }, { transform: to }], {
                duration: 240, easing: "cubic-bezier(.22,.7,.2,1)", fill: "forwards",
            })
            const currentNavigation = navigation
            // Cancellation cannot retract a fulfilled promise already queued
            // as a microtask. Only this still-current transition may complete.
            void navigation.finished.then(() => {
                if (!disposed && navigation === currentNavigation) finished()
            }).catch(() => undefined)
        }
        const removeWait = () => {
            window.clearTimeout(waitTimer)
            window.cancelAnimationFrame(waitFrame)
            window.visualViewport?.removeEventListener("resize", checkKeyboard)
            window.removeEventListener("resize", checkKeyboard)
        }
        const leave = () => {
            if (disposed || phase === "leaving") return
            removeWait()
            setPhase("leaving")
            animate(true, () => {
                target.style.transform = "translateX(100%)"
                current.current.onClose()
            })
        }
        function checkKeyboard() {
            const height = window.visualViewport?.height ?? window.innerHeight
            const layoutHeight = document.documentElement.clientHeight || window.innerHeight
            if (height >= layoutHeight - 1) leave()
        }
        const reduceNavigation = () => {
            if (!disposed && reduced.matches) navigation?.finish()
        }
        reduced.addEventListener("change", reduceNavigation)
        close.current = () => {
            if (phase !== "open" && phase !== "entering") return
            const focused = document.activeElement
            const viewportHeight = window.visualViewport?.height ?? window.innerHeight
            const layoutHeight = document.documentElement.clientHeight || window.innerHeight
            const keyboardWasFocused = viewportHeight < layoutHeight - 1 || (focused instanceof HTMLElement && target.contains(focused)
                && focused.matches("input, textarea, [contenteditable=true]"))
            if (focused instanceof HTMLElement && target.contains(focused)) focused.blur()
            target.inert = true
            if (!keyboardWasFocused) { leave(); return }
            cancelNavigation()
            target.style.transform = "none"
            setPhase("dismissing-keyboard")
            // Keep opaque coverage until the measured viewport returns. The
            // bounded fallback permits Back even if an OS omits resize events.
            window.visualViewport?.addEventListener("resize", checkKeyboard)
            window.addEventListener("resize", checkKeyboard)
            waitFrame = requestAnimationFrame(checkKeyboard)
            waitTimer = window.setTimeout(leave, 700)
        }
        setPhase("entering")
        target.inert = true
        animate(false, presented)
        return () => {
            disposed = true
            close.current = null
            reduced.removeEventListener("change", reduceNavigation)
            removeWait()
            cancelNavigation()
            stopViewport()
            ownership.release()
            target.style.transform = ""
            target.inert = false
            queueMicrotask(() => {
                if (!current.current.selected && previousFocus?.isConnected && !previousFocus.closest("[inert]")) previousFocus.focus({ preventScroll: true })
            })
        }
    }, [active, mobile, selected, portalTarget])

    return <div ref={attach} className="contents" data-conversation-surface-anchor data-inline-conversation-selected={!mobile && selected ? "true" : undefined}
        onClickCapture={event => {
            if (!(event.target instanceof Element) || !event.target.closest("[data-mobile-conversation-back]") || !close.current) return
            event.preventDefault()
            event.stopPropagation()
            close.current()
        }}>
        {portalTarget ? createPortal(children, portalTarget) : null}
    </div>
}
