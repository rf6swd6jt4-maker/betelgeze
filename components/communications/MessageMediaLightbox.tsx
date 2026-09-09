"use client"

import Image from "next/image"
import { useEffect, useRef } from "react"
import { clampImageZoom, moveImageZoom, type ImageZoom, type ImageZoomPoint } from "@/lib/communications/image-zoom"

export type MessageMediaPreview = { url: string; alt: string }

function ImagePreview({ media, onClose }: { media: MessageMediaPreview; onClose: () => void }) {
    const viewerRef = useRef<HTMLDivElement>(null)
    const imageRef = useRef<HTMLImageElement>(null)
    const dragged = useRef(false)

    useEffect(() => {
        const viewer = viewerRef.current!
        const image = imageRef.current!
        let zoom: ImageZoom = { scale: 1, x: 0, y: 0 }
        const pointers = new Map<number, ImageZoomPoint>()
        let start: ImageZoomPoint | null = null
        const bounds = () => {
            // object-contain can leave empty space inside the image element.
            const fit = image.naturalWidth && image.naturalHeight ? Math.min(image.offsetWidth / image.naturalWidth, image.offsetHeight / image.naturalHeight) : 1
            return { width: image.naturalWidth ? image.naturalWidth * fit : image.offsetWidth, height: image.naturalHeight ? image.naturalHeight * fit : image.offsetHeight, viewportWidth: viewer.clientWidth, viewportHeight: viewer.clientHeight }
        }
        const paint = () => { image.style.transform = `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})` }
        const point = (event: PointerEvent) => {
            const rect = viewer.getBoundingClientRect()
            return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }
        }
        const down = (event: PointerEvent) => {
            if ((event.target as Element).closest("button") || (event.pointerType === "mouse" && event.button !== 0)) return
            if (!pointers.size) { dragged.current = false; start = point(event) }
            pointers.set(event.pointerId, point(event))
            if (pointers.size > 1) dragged.current = true
            // Keep image taps targeted at the image, even after pointer capture.
            ;(event.target as Element).setPointerCapture(event.pointerId)
        }
        const move = (event: PointerEvent) => {
            if (!pointers.has(event.pointerId)) return
            const before = [...pointers.values()]
            const next = point(event)
            pointers.set(event.pointerId, next)
            if (start && Math.hypot(next.x - start.x, next.y - start.y) > 6) dragged.current = true
            zoom = moveImageZoom(zoom, before, [...pointers.values()], bounds())
            paint()
        }
        const end = (event: PointerEvent) => {
            pointers.delete(event.pointerId)
            if (event.type === "pointercancel") dragged.current = true
            start = pointers.values().next().value ?? null
        }
        // Explicit non-passive listeners also contain Safari's native zoom gestures.
        const preventGesture = (event: Event) => { if (event.cancelable) event.preventDefault() }
        const preventMultiTouch = (event: TouchEvent) => { if (event.touches.length > 1) preventGesture(event) }
        const resize = () => { zoom = clampImageZoom(zoom, bounds()); paint() }
        const observer = new ResizeObserver(resize)
        observer.observe(viewer)
        observer.observe(image)
        image.addEventListener("load", resize)
        viewer.addEventListener("pointerdown", down)
        viewer.addEventListener("pointermove", move)
        viewer.addEventListener("pointerup", end)
        viewer.addEventListener("pointercancel", end)
        viewer.addEventListener("lostpointercapture", end)
        viewer.addEventListener("touchstart", preventMultiTouch, { passive: false })
        viewer.addEventListener("touchmove", preventGesture, { passive: false })
        viewer.addEventListener("gesturestart", preventGesture)
        viewer.addEventListener("gesturechange", preventGesture)
        return () => {
            observer.disconnect()
            image.removeEventListener("load", resize)
            viewer.removeEventListener("pointerdown", down)
            viewer.removeEventListener("pointermove", move)
            viewer.removeEventListener("pointerup", end)
            viewer.removeEventListener("pointercancel", end)
            viewer.removeEventListener("lostpointercapture", end)
            viewer.removeEventListener("touchstart", preventMultiTouch)
            viewer.removeEventListener("touchmove", preventGesture)
            viewer.removeEventListener("gesturestart", preventGesture)
            viewer.removeEventListener("gesturechange", preventGesture)
        }
    }, [])

    return <div ref={viewerRef} role="dialog" aria-modal="true" aria-label="Image preview" onClick={(event) => { if (event.target === event.currentTarget && !dragged.current) onClose() }} className="betelgeze-popup-fade fixed inset-0 z-[180] flex touch-none select-none items-center justify-center overflow-hidden overscroll-none bg-black/95 p-3 sm:p-8">
        <button type="button" onClick={onClose} aria-label="Close image preview" className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-neutral-900/90 text-2xl text-white shadow-xl hover:bg-neutral-800 sm:right-5 sm:top-5">×</button>
        <Image ref={imageRef} unoptimized draggable={false} src={media.url} alt={media.alt} width={1800} height={1400} className="max-h-[calc(100dvh-1.5rem)] max-w-full touch-none object-contain will-change-transform sm:max-h-[calc(100dvh-4rem)]" />
    </div>
}

export function MessageMediaLightbox({ media, onClose }: { media: MessageMediaPreview | null; onClose: () => void }) {
    useEffect(() => {
        if (!media) return
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
        window.addEventListener("keydown", closeOnEscape)
        return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape) }
    }, [media, onClose])

    return media ? <ImagePreview key={media.url} media={media} onClose={onClose} /> : null
}
