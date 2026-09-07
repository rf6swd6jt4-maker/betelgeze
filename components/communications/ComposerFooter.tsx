"use client"

import { useLayoutEffect, useRef, type ComponentProps } from "react"
import { containComposerTouch } from "./composer-touch"

export function ComposerFooter(props: ComponentProps<"footer">) {
    const ref = useRef<HTMLElement>(null)
    const slotRef = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        const footer = ref.current, slot = slotRef.current
        if (!footer || !slot) return
        const releaseTouch = containComposerTouch(footer)
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
        <footer {...props} ref={ref} />
    </div>
}
