"use client"

import { useEffect, useRef } from "react"
import {
    beginPullToRefreshGesture,
    pullCanStartAt,
    shouldRefreshFromPull,
    updatePullToRefreshGesture,
    type PullToRefreshGesture,
} from "@/lib/pull-to-refresh"

type Props = {
    active: boolean
    refreshing: boolean
    onRefresh: () => void
    getScrollElement?: () => HTMLElement | null
    placement?: "fixed" | "absolute"
}

export function PullToRefresh({ active, refreshing, onRefresh, getScrollElement, placement = "fixed" }: Props) {
    const gesture = useRef<PullToRefreshGesture | null>(null)

    useEffect(() => {
        if (!active || refreshing) return
        const mobile = window.matchMedia("(max-width: 767px)")
        if (!mobile.matches) return
        const scrollElement = getScrollElement?.() ?? null
        const target = scrollElement ?? window
        const scrollingElement = scrollElement ?? document.scrollingElement

        const start = (event: Event) => {
            const touchEvent = event as TouchEvent
            if (touchEvent.touches.length !== 1 || !pullCanStartAt(touchEvent.target, scrollingElement)) return
            const touch = touchEvent.touches[0]
            gesture.current = beginPullToRefreshGesture(touch.clientX, touch.clientY)
        }
        const move = (event: Event) => {
            const touchEvent = event as TouchEvent
            if (!gesture.current || touchEvent.touches.length !== 1) return
            const touch = touchEvent.touches[0]
            const next = updatePullToRefreshGesture(gesture.current, touch.clientX, touch.clientY)
            gesture.current = next
        }
        const finish = () => {
            const current = gesture.current
            gesture.current = null
            if (current && shouldRefreshFromPull(current)) onRefresh()
        }
        const cancel = () => { gesture.current = null }

        target.addEventListener("touchstart", start, { passive: true })
        target.addEventListener("touchmove", move, { passive: true })
        target.addEventListener("touchend", finish, { passive: true })
        target.addEventListener("touchcancel", cancel, { passive: true })
        return () => {
            gesture.current = null
            target.removeEventListener("touchstart", start)
            target.removeEventListener("touchmove", move)
            target.removeEventListener("touchend", finish)
            target.removeEventListener("touchcancel", cancel)
        }
    }, [active, getScrollElement, onRefresh, refreshing])

    if (!active || !refreshing) return null
    return <div
        role="status"
        aria-live="polite"
        aria-label="Refreshing tab"
        className={`pointer-events-none ${placement} inset-0 z-[80] grid place-items-center bg-black md:hidden`}
    >
        <span aria-hidden="true" className="h-7 w-7 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-100 motion-reduce:animate-none" />
    </div>
}
