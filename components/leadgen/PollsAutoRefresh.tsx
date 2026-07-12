"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"

export function PollsAutoRefresh({ enabled, intervalMs = 5000, processUrl }: { enabled: boolean; intervalMs?: number; processUrl?: string }) {
    const router = useRouter()
    const tabActive = useWorkspaceTabActive()
    useEffect(() => {
        if (!enabled || !tabActive) return
        let cancelled = false
        let navigating = false
        let processing = false
        let activeRequest: AbortController | null = null
        const tick = async () => {
            if (navigating || document.visibilityState !== "visible") return
            if (processUrl && !processing) {
                processing = true
                activeRequest = new AbortController()
                fetch(processUrl, { method: "POST", signal: activeRequest.signal })
                    .catch(() => null)
                    .finally(() => {
                        processing = false
                        activeRequest = null
                        if (!cancelled && !navigating) window.setTimeout(() => {
                            if (!cancelled && !navigating) router.refresh()
                        }, 700)
                    })
                return
            }
            router.refresh()
        }
        const pauseForNavigation = () => {
            navigating = true
            activeRequest?.abort()
        }
        const initialTimer = window.setTimeout(() => void tick(), 250)
        const timer = window.setInterval(() => void tick(), intervalMs)
        window.addEventListener("focus", tick)
        window.addEventListener("betelgeze:workspace-navigation-start", pauseForNavigation)
        return () => {
            cancelled = true
            window.clearTimeout(initialTimer)
            window.clearInterval(timer)
            window.removeEventListener("focus", tick)
            window.removeEventListener("betelgeze:workspace-navigation-start", pauseForNavigation)
            activeRequest?.abort()
        }
    }, [enabled, intervalMs, processUrl, router, tabActive])

    return null
}
