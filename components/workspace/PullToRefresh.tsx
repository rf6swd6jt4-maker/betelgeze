"use client"

import { useEffect, useRef, useState } from "react"
import {
    beginPullToRefreshGesture,
    PULL_TO_REFRESH_THRESHOLD,
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
}

export function PullToRefresh({ active, refreshing, onRefresh, getScrollElement }: Props) {
    const gesture = useRef<PullToRefreshGesture | null>(null)
    const [distance, setDistance] = useState(0)

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
            setDistance(next.distance)
            if (next.distance > 0) touchEvent.preventDefault()
        }
        const finish = () => {
            const current = gesture.current
            gesture.current = null
            setDistance(0)
            if (current && shouldRefreshFromPull(current)) onRefresh()
        }

        target.addEventListener("touchstart", start, { passive: true })
        target.addEventListener("touchmove", move, { passive: false })
        target.addEventListener("touchend", finish, { passive: true })
        target.addEventListener("touchcancel", finish, { passive: true })
        return () => {
            gesture.current = null
            target.removeEventListener("touchstart", start)
            target.removeEventListener("touchmove", move)
            target.removeEventListener("touchend", finish)
            target.removeEventListener("touchcancel", finish)
        }
    }, [active, getScrollElement, onRefresh, refreshing])

    if (!active || (!distance && !refreshing)) return null
    const armed = distance >= PULL_TO_REFRESH_THRESHOLD
    const visibleDistance = refreshing ? 44 : distance
    return <div
        aria-live="polite"
        className="pointer-events-none fixed left-1/2 top-3 z-[80] flex h-9 min-w-9 -translate-x-1/2 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950/95 px-2 text-neutral-300 shadow-xl shadow-black/30 md:hidden"
        style={{ transform: `translate(-50%, ${Math.max(0, visibleDistance - 44)}px)`, opacity: Math.min(1, Math.max(0.2, visibleDistance / 32)) }}
    >
        <span className={`block h-4 w-4 rounded-full border-2 border-neutral-600 border-t-neutral-100 ${refreshing ? "animate-spin" : ""}`} />
        <span className="sr-only">{refreshing ? "Refreshing tab" : armed ? "Release to refresh tab" : "Pull to refresh tab"}</span>
    </div>
}
