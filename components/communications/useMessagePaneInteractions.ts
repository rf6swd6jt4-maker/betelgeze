"use client"

import { useRef, type PointerEvent, type RefObject } from "react"

const POINTER_SCROLL_THRESHOLD_PX = 6

export function useMessagePaneInteractions(
    composerRef: RefObject<HTMLElement | null>,
) {
    const pointerGestureRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null)

    return {
        onPointerDown(event: PointerEvent<HTMLDivElement>) {
            pointerGestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
        },
        onPointerMove(event: PointerEvent<HTMLDivElement>) {
            const gesture = pointerGestureRef.current
            if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return
            if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < POINTER_SCROLL_THRESHOLD_PX) return
            gesture.moved = true
        },
        onPointerUp(event: PointerEvent<HTMLDivElement>) {
            const gesture = pointerGestureRef.current
            pointerGestureRef.current = null
            if (!gesture || gesture.pointerId !== event.pointerId) return
            if (!gesture.moved && !(event.target instanceof Element && event.target.closest("button,a,input,textarea,select,video,audio,[role='slider'],[data-message-control]"))) composerRef.current?.blur()
        },
        onPointerCancel() {
            pointerGestureRef.current = null
        },
    }
}
