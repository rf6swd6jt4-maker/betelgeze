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
    getPullTarget?: () => HTMLElement | null
    placement?: "fixed" | "absolute"
}

type OriginalPullStyles = Pick<CSSStyleDeclaration, "transform" | "transition" | "willChange">

function naturalPullDistance(target: EventTarget | null, scrollingElement: Element | null) {
    if (!(target instanceof Element)) return 0
    let mostNegativeScroll = 0
    for (let element: Element | null = target; element; element = element.parentElement) {
        mostNegativeScroll = Math.min(mostNegativeScroll, element.scrollTop)
        if (element === scrollingElement) break
    }
    if (scrollingElement) mostNegativeScroll = Math.min(mostNegativeScroll, scrollingElement.scrollTop)
    return Math.max(0, -mostNegativeScroll)
}

export function PullToRefresh({ active, refreshing, onRefresh, getScrollElement, getPullTarget, placement = "fixed" }: Props) {
    const gesture = useRef<PullToRefreshGesture | null>(null)
    const [distance, setDistance] = useState(0)

    useEffect(() => {
        if (!active || refreshing) return
        const mobile = window.matchMedia("(max-width: 767px)")
        if (!mobile.matches) return
        const scrollElement = getScrollElement?.() ?? null
        const target = scrollElement ?? window
        const scrollingElement = scrollElement ?? document.scrollingElement
        let pulledElement: HTMLElement | null = null
        let originalStyles: OriginalPullStyles | null = null
        let restoreTimer: number | null = null

        const restorePulledElement = (animate: boolean) => {
            if (!pulledElement || !originalStyles) return
            const element = pulledElement
            const original = originalStyles
            if (restoreTimer) window.clearTimeout(restoreTimer)
            if (animate) {
                element.style.transition = "transform 160ms cubic-bezier(0.22, 1, 0.36, 1)"
                element.style.transform = original.transform
                restoreTimer = window.setTimeout(() => {
                    element.style.transition = original.transition
                    element.style.willChange = original.willChange
                    restoreTimer = null
                }, 180)
            } else {
                element.style.transform = original.transform
                element.style.transition = original.transition
                element.style.willChange = original.willChange
                restoreTimer = null
            }
            pulledElement = null
            originalStyles = null
        }

        const applySyntheticPull = (nextDistance: number) => {
            const element = pulledElement ?? getPullTarget?.() ?? document.querySelector<HTMLElement>("[data-communications-panel]")
            if (!element) return
            if (!pulledElement) {
                pulledElement = element
                originalStyles = {
                    transform: element.style.transform,
                    transition: element.style.transition,
                    willChange: element.style.willChange,
                }
            }
            element.style.transition = "none"
            element.style.willChange = "transform"
            element.style.transform = `${originalStyles?.transform || ""} translate3d(0, ${nextDistance}px, 0)`.trim()
        }

        const start = (event: Event) => {
            const touchEvent = event as TouchEvent
            if (touchEvent.touches.length !== 1 || !pullCanStartAt(touchEvent.target, scrollingElement)) return
            const touch = touchEvent.touches[0]
            gesture.current = beginPullToRefreshGesture(touch.clientX, touch.clientY)
            setDistance(0)
        }
        const move = (event: Event) => {
            const touchEvent = event as TouchEvent
            if (!gesture.current || touchEvent.touches.length !== 1) return
            const touch = touchEvent.touches[0]
            const next = updatePullToRefreshGesture(gesture.current, touch.clientX, touch.clientY)
            gesture.current = next
            setDistance(next.distance)
            if (next.cancelled || next.distance === 0 || naturalPullDistance(touchEvent.target, scrollingElement) > 1) restorePulledElement(false)
            else applySyntheticPull(next.distance)
        }
        const finish = () => {
            const current = gesture.current
            gesture.current = null
            setDistance(0)
            restorePulledElement(true)
            if (current && shouldRefreshFromPull(current)) onRefresh()
        }
        const cancel = () => {
            gesture.current = null
            setDistance(0)
            restorePulledElement(true)
        }

        target.addEventListener("touchstart", start, { passive: true })
        target.addEventListener("touchmove", move, { passive: true })
        target.addEventListener("touchend", finish, { passive: true })
        target.addEventListener("touchcancel", cancel, { passive: true })
        return () => {
            gesture.current = null
            if (restoreTimer) window.clearTimeout(restoreTimer)
            restorePulledElement(false)
            target.removeEventListener("touchstart", start)
            target.removeEventListener("touchmove", move)
            target.removeEventListener("touchend", finish)
            target.removeEventListener("touchcancel", cancel)
        }
    }, [active, getPullTarget, getScrollElement, onRefresh, refreshing])

    if (!active) return null
    if (refreshing) return <div
        role="status"
        aria-live="polite"
        aria-label="Refreshing tab"
        className={`pointer-events-none ${placement} left-1/2 top-2 z-[80] grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full border border-neutral-700 bg-black/90 shadow-lg shadow-black/30 md:hidden`}
    >
        <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-100 motion-reduce:animate-none" />
    </div>

    if (!distance) return null
    const progress = Math.min(1, distance / PULL_TO_REFRESH_THRESHOLD)
    return <div
        aria-hidden="true"
        className={`pointer-events-none ${placement} left-1/2 top-0 z-[80] grid h-9 w-9 place-items-center rounded-full border border-neutral-700 bg-black/90 shadow-lg shadow-black/30 md:hidden`}
        style={{ opacity: 0.25 + progress * 0.75, transform: `translate3d(-50%, ${-36 + progress * 52}px, 0) scale(${0.82 + progress * 0.18})` }}
    >
        <span className="h-5 w-5 rounded-full border-2 border-neutral-700 border-t-neutral-100" style={{ transform: `rotate(${progress * 300}deg)` }} />
    </div>
}
