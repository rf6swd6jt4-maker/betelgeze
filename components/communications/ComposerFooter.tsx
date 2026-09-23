"use client"

import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react"
import { containComposerTouch } from "./composer-touch"

export function ComposerFooter({ accessories, children, ...props }: ComponentProps<"footer"> & { accessories?: ReactNode }) {
    const ref = useRef<HTMLElement>(null)
    const slotRef = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        const footer = ref.current, slot = slotRef.current
        if (!footer || !slot) return
        const releaseTouch = containComposerTouch(footer)
        // In the mobile resident surface normal flex layout measures the whole
        // composer in the same layout pass as the message pane. No observer or
        // independent height animation may lag behind the keyboard or editor.
        if (footer.closest("[data-mobile-comms-tab]")) return releaseTouch
        const mobile = window.matchMedia("(max-width: 1023px)")
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
        let previousHeight = 0
        const measure = () => {
            const height = footer.getBoundingClientRect().height
            if (height <= 0 || height === previousHeight) return
            slot.style.transition = previousHeight && mobile.matches && !reducedMotion.matches
                ? "height 180ms cubic-bezier(0.25, 0.1, 0.25, 1)" : "none"
            slot.style.height = `${height}px`
            previousHeight = height
        }
        const observer = new ResizeObserver(measure)
        observer.observe(footer)
        measure()
        return () => { releaseTouch(); observer.disconnect() }
    }, [])
    return <div ref={slotRef} className="relative z-10 flex shrink-0 flex-col justify-end overflow-clip" data-composer-slot>
        <footer {...props} ref={ref}>
            {accessories !== undefined ? <div data-composer-accessories data-composer-scroll>{accessories}</div> : null}
            {children}
        </footer>
    </div>
}
