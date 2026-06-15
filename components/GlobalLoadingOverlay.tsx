"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { LoadingOverlay } from "@/components/LoadingOverlay"

function shouldIgnoreClick(event: MouseEvent) {
    if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    ) {
        return true
    }

    const target = event.target as Element | null
    const link = target?.closest("a[href]") as HTMLAnchorElement | null

    if (!link) return true
    if (link.target && link.target !== "_self") return true
    if (link.dataset.globalLoading === "false") return true

    const href = link.getAttribute("href")

    if (!href || href.startsWith("#") || href.startsWith("mailto:")) {
        return true
    }

    const nextUrl = new URL(href, window.location.href)

    return (
        nextUrl.origin !== window.location.origin ||
        nextUrl.href === window.location.href
    )
}

export function GlobalLoadingOverlay() {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const currentRouteKey = `${pathname}?${searchParams.toString()}`
    const [loadingRouteKey, setLoadingRouteKey] = useState<string | null>(null)
    const previousRouteKey = useRef(currentRouteKey)

    useEffect(() => {
        function handleClick(event: MouseEvent) {
            if (!shouldIgnoreClick(event)) {
                setLoadingRouteKey(currentRouteKey)
            }
        }

        function handlePageShow() {
            setLoadingRouteKey(null)
        }

        document.addEventListener("click", handleClick, true)
        window.addEventListener("pageshow", handlePageShow)

        return () => {
            document.removeEventListener("click", handleClick, true)
            window.removeEventListener("pageshow", handlePageShow)
        }
    }, [currentRouteKey])

    useEffect(() => {
        if (previousRouteKey.current !== currentRouteKey) {
            previousRouteKey.current = currentRouteKey
            setLoadingRouteKey(null)
        }
    }, [currentRouteKey])

    useEffect(() => {
        if (!loadingRouteKey) return

        const timeout = window.setTimeout(() => {
            setLoadingRouteKey(null)
        }, 8000)

        return () => window.clearTimeout(timeout)
    }, [loadingRouteKey])

    return loadingRouteKey === currentRouteKey ? <LoadingOverlay /> : null
}
