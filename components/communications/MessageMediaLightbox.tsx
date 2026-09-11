"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import { ConversationMedia, useConversationMedia } from "@/components/communications/ConversationMedia"
import { clampImageZoom, moveImageZoom, type ImageZoom, type ImageZoomPoint } from "@/lib/communications/image-zoom"

export type MessageMediaItem = { url: string; alt: string; kind?: "image" | "video"; thumbnailUrl?: string }
export type MessageMediaPreview = MessageMediaItem & { items?: MessageMediaItem[] }

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

    return <div ref={viewerRef} onClick={(event) => { if (event.target === event.currentTarget && !dragged.current) onClose() }} className="flex h-full w-full touch-none select-none items-center justify-center overflow-hidden overscroll-none">
        <Image ref={imageRef} unoptimized draggable={false} src={media.url} alt={media.alt} width={1800} height={1400} className="h-full w-full touch-none object-contain will-change-transform" />
    </div>
}

function MediaThumbnail({ media }: { media: MessageMediaItem }) {
    const [failed, setFailed] = useState(false)
    const { ref, admitted, complete } = useConversationMedia(Boolean(media.thumbnailUrl))
    return <div ref={ref} className="flex h-full w-full items-center justify-center">
        {media.thumbnailUrl && !failed ? admitted ? <Image unoptimized src={media.thumbnailUrl} alt="" width={64} height={64} loading="eager" onLoad={complete} onError={() => { complete(); setFailed(true) }} className="h-full w-full object-cover" /> : null : <span className="px-1 text-[10px] text-white/70">{media.alt}</span>}
        {media.kind === "video" ? <svg viewBox="0 0 24 24" aria-hidden="true" className="absolute h-5 w-5 fill-white drop-shadow"><path d="m8 4 12 8-12 8Z" /></svg> : null}
    </div>
}

function MediaGallery({ media, onClose }: { media: MessageMediaPreview; onClose: () => void }) {
    const items = media.items?.length ? media.items : [media]
    const [index, setIndex] = useState(() => Math.max(0, items.findIndex((item) => item.url === media.url)))
    const selected = items[index] ?? items[0]
    const multiple = items.length > 1
    const dialogRef = useRef<HTMLDivElement>(null)
    const stripRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null
        dialogRef.current?.focus()
        return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
    }, [])
    useEffect(() => {
        const strip = stripRef.current
        const button = strip?.children[index] as HTMLElement | undefined
        if (!strip || !button) return
        if (button.offsetLeft < strip.scrollLeft) strip.scrollLeft = button.offsetLeft
        else if (button.offsetLeft + button.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = button.offsetLeft + button.offsetWidth - strip.clientWidth
    }, [index])
    const previous = () => { setIndex((value) => Math.max(0, value - 1)); dialogRef.current?.focus({ preventScroll: true }) }
    const next = () => { setIndex((value) => Math.min(items.length - 1, value + 1)); dialogRef.current?.focus({ preventScroll: true }) }
    const arrowClass = "absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-white drop-shadow-lg hover:text-white/70 disabled:opacity-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
    return <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Image preview" tabIndex={-1} className="betelgeze-popup-fade fixed inset-0 z-[180] flex flex-col overflow-hidden overscroll-none bg-black/95 text-white outline-none" onKeyDown={(event) => {
        if (event.key === "Tab") {
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], video[controls], [tabindex="0"]'))
            const first = controls[0], last = controls.at(-1)
            if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
        if (!multiple || (event.target as Element).closest("video")) return
        if (event.key === "ArrowLeft") { event.preventDefault(); previous() }
        if (event.key === "ArrowRight") { event.preventDefault(); next() }
    }}>
        <button type="button" data-icon-button onClick={onClose} aria-label="Close image preview" className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-neutral-900/90 text-2xl text-white shadow-xl hover:bg-neutral-800 sm:right-5 sm:top-5">×</button>
        <div className="relative min-h-0 flex-1" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
            <div className="absolute inset-x-3 bottom-3 top-16 sm:inset-x-16 sm:bottom-6">
                {selected.kind === "video" ? <video key={selected.url} src={selected.url} controls playsInline preload="metadata" aria-label={selected.alt} className="h-full w-full object-contain" /> : <ImagePreview key={selected.url} media={selected} onClose={onClose} />}
            </div>
            {multiple ? <>
                <button type="button" data-icon-button aria-label="Previous media" disabled={index === 0} onClick={previous} className={`${arrowClass} left-1 sm:left-3`}><svg viewBox="0 0 24 24" aria-hidden="true" className="h-8 w-8 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 5-7 7 7 7" /></svg></button>
                <button type="button" data-icon-button aria-label="Next media" disabled={index === items.length - 1} onClick={next} className={`${arrowClass} right-1 sm:right-3`}><svg viewBox="0 0 24 24" aria-hidden="true" className="h-8 w-8 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 5 7 7-7 7" /></svg></button>
            </> : null}
        </div>
        {multiple ? <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <p aria-live="polite" className="mb-2 text-center text-xs text-white/70">{index + 1} / {items.length}</p>
            <div ref={stripRef} role="group" aria-label="Message media" className="relative mx-auto flex w-fit max-w-full gap-2 overflow-x-auto overscroll-x-contain p-1">
                <ConversationMedia active>{items.map((item, position) => <button key={item.url} type="button" data-icon-button aria-label={`View ${position + 1}: ${item.alt}`} aria-pressed={position === index} onClick={() => setIndex(position)} className={`relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/10 sm:h-16 sm:w-16 ${position === index ? "ring-2 ring-white" : "opacity-60 hover:opacity-100"}`}><MediaThumbnail media={item} /></button>)}</ConversationMedia>
            </div>
        </div> : null}
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

    return media ? <MediaGallery key={media.url} media={media} onClose={onClose} /> : null
}
