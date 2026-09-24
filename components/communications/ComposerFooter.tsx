"use client"

import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react"
import { MOBILE_CONVERSATION_VISIBILITY_EVENT } from "@/lib/mobile-conversation-viewport"
import { containComposerTouch } from "./composer-touch"

export function ComposerFooter({ accessories, children, ...props }: ComponentProps<"footer"> & { accessories?: ReactNode }) {
    const ref = useRef<HTMLElement>(null)
    const slotRef = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        const footer = ref.current, slot = slotRef.current
        if (!footer || !slot) return
        const releaseTouch = containComposerTouch(footer)
        const view = footer.ownerDocument.defaultView!
        const mobile = view.matchMedia("(max-width: 1023px)")
        const reducedMotion = view.matchMedia("(prefers-reduced-motion: reduce)")
        let previousHeight = 0
        let observer: ResizeObserver | null = null
        let frame = 0
        const measure = () => {
            if (!observer) return
            const height = footer.getBoundingClientRect().height
            if (height <= 0 || height === previousHeight) return
            slot.style.transition = previousHeight && mobile.matches && !reducedMotion.matches
                ? "height 180ms cubic-bezier(0.25, 0.1, 0.25, 1)" : "none"
            slot.style.height = `${height}px`
            previousHeight = height
        }
        const releaseHeight = () => {
            observer?.disconnect()
            observer = null
            previousHeight = 0
            slot.style.removeProperty("height")
            slot.style.removeProperty("transition")
        }
        const reconcile = () => {
            // Normal flex layout must take over immediately when the existing
            // editor is moved into the resident mobile surface.
            if (footer.closest("[data-mobile-comms-tab], [data-mobile-conversation-surface]")) {
                releaseHeight()
            } else if (!observer) {
                observer = new ResizeObserver(measure)
                observer.observe(footer)
                measure()
            }
        }
        const update = () => {
            reconcile()
            view.cancelAnimationFrame(frame)
            frame = view.requestAnimationFrame(() => { frame = 0; reconcile() })
        }
        view.addEventListener(MOBILE_CONVERSATION_VISIBILITY_EVENT, update)
        mobile.addEventListener("change", update)
        update()
        return () => {
            view.cancelAnimationFrame(frame)
            view.removeEventListener(MOBILE_CONVERSATION_VISIBILITY_EVENT, update)
            mobile.removeEventListener("change", update)
            releaseHeight()
            releaseTouch()
        }
    }, [])
    return <div ref={slotRef} className="relative z-10 flex shrink-0 flex-col justify-end overflow-clip" data-composer-slot>
        <footer {...props} ref={ref}>
            {accessories !== undefined ? <div data-composer-accessories data-composer-scroll>{accessories}</div> : null}
            {children}
        </footer>
    </div>
}
