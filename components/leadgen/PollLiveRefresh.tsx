"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"

export function PollLiveRefresh({ enabled, intervalMs = 5000 }: { enabled: boolean; intervalMs?: number }) {
    const router = useRouter()
    const tabActive = useWorkspaceTabActive()

    useEffect(() => {
        if (!enabled || !tabActive) return
        let navigating = false
        const refresh = () => {
            if (!navigating) router.refresh()
        }
        const pauseForNavigation = () => { navigating = true }
        const timer = window.setInterval(refresh, intervalMs)
        window.addEventListener("betelgeze:workspace-navigation-start", pauseForNavigation)
        return () => {
            window.clearInterval(timer)
            window.removeEventListener("betelgeze:workspace-navigation-start", pauseForNavigation)
        }
    }, [enabled, intervalMs, router, tabActive])

    return null
}
