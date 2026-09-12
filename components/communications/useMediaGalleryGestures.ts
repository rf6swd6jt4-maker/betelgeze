"use client"

import { useEffect, useRef, type RefObject } from "react"

/** The image owns pinch/pan; the gallery owns one-finger horizontal movement at 1x. */
export function useMediaGalleryGestures({ viewportRef, trackRef, zoomed, index, count, onSelect }: {
    viewportRef: RefObject<HTMLDivElement | null>
    trackRef: RefObject<HTMLDivElement | null>
    zoomed: RefObject<boolean>
    index: number
    count: number
    onSelect: (index: number) => void
}) {
    const selectRef = useRef(onSelect)
    const suppressClick = useRef(false)
    const wheelGesture = useRef({ last: 0, distance: 0, locked: false })
    useEffect(() => { selectRef.current = onSelect }, [onSelect])
    useEffect(() => {
        const viewport = viewportRef.current
        const track = trackRef.current
        if (!viewport || !track || count < 2) return
        const pointers = new Set<number>()
        let startX = 0, startY = 0, distance = 0
        let cancelled = false, horizontal = false
        const reset = () => {
            track.style.transition = ""
            track.style.transform = `translate3d(${-index * 100}%, 0, 0)`
        }
        const paint = (delta: number) => {
            const atEdge = (index === 0 && delta > 0) || (index === count - 1 && delta < 0)
            const offset = Math.max(-viewport.clientWidth, Math.min(viewport.clientWidth, delta)) * (atEdge ? 0.2 : 1)
            track.style.transition = "none"
            track.style.transform = `translate3d(calc(${-index * 100}% + ${offset}px), 0, 0)`
        }
        const down = (event: PointerEvent) => {
            if (event.pointerType === "mouse" && event.button !== 0) return
            pointers.add(event.pointerId)
            if (pointers.size > 1 || zoomed.current) { cancelled = true; reset(); return }
            const target = event.target as Element
            const video = target.closest("video")
            // Leave the native scrubber, volume and fullscreen controls alone.
            const videoBounds = video?.getBoundingClientRect()
            const onVideoControls = videoBounds && (event.clientY >= videoBounds.bottom - 72 || event.clientY <= videoBounds.top + 72)
            cancelled = Boolean(target.closest("button, a, input") || onVideoControls)
            startX = event.clientX; startY = event.clientY; distance = 0; horizontal = false; suppressClick.current = false
        }
        const move = (event: PointerEvent) => {
            if (!pointers.has(event.pointerId) || pointers.size !== 1 || cancelled) return
            if (zoomed.current) { cancelled = true; reset(); return }
            const dx = event.clientX - startX, dy = event.clientY - startY
            if (!horizontal) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return
                if (Math.abs(dy) >= Math.abs(dx)) { cancelled = true; return }
                horizontal = true
                viewport.setPointerCapture(event.pointerId)
            }
            if (event.cancelable) event.preventDefault()
            suppressClick.current = true
            distance = dx
            paint(dx)
        }
        const end = (event: PointerEvent) => {
            if (!pointers.delete(event.pointerId)) return
            if (pointers.size) return
            track.style.transition = ""
            if (!cancelled && horizontal && event.type === "pointerup" && Math.abs(distance) >= Math.min(80, viewport.clientWidth * 0.2)) {
                selectRef.current(index + (distance < 0 ? 1 : -1))
            }
            reset()
            horizontal = false
        }
        const click = (event: MouseEvent) => {
            if (!suppressClick.current) return
            suppressClick.current = false
            event.preventDefault(); event.stopPropagation()
        }
        const wheel = (event: WheelEvent) => {
            if (event.ctrlKey || zoomed.current || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
            event.preventDefault()
            const gesture = wheelGesture.current
            const now = performance.now()
            if (now - gesture.last > 180) { gesture.distance = 0; gesture.locked = false }
            gesture.last = now
            if (gesture.locked) return
            gesture.distance += event.deltaX * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1)
            if (Math.abs(gesture.distance) >= 60) {
                gesture.locked = true
                selectRef.current(index + (gesture.distance > 0 ? 1 : -1))
            }
        }
        viewport.addEventListener("pointerdown", down)
        viewport.addEventListener("pointermove", move, { passive: false })
        viewport.addEventListener("pointerup", end)
        viewport.addEventListener("pointercancel", end)
        viewport.addEventListener("click", click, true)
        viewport.addEventListener("wheel", wheel, { passive: false })
        return () => {
            viewport.removeEventListener("pointerdown", down)
            viewport.removeEventListener("pointermove", move)
            viewport.removeEventListener("pointerup", end)
            viewport.removeEventListener("pointercancel", end)
            viewport.removeEventListener("click", click, true)
            viewport.removeEventListener("wheel", wheel)
            track.style.transition = ""
        }
    }, [count, index, trackRef, viewportRef, zoomed])
}
