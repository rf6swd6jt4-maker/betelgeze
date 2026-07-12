"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"

export function ListAutoRefresh({ intervalMs = 8000 }: { intervalMs?: number }) {
    const router = useRouter()
    const tabActive = useWorkspaceTabActive()
    useEffect(() => {
        if (!tabActive) return
        let navigating = false
        const refresh = () => {
            if (!navigating && document.visibilityState === "visible") router.refresh()
        }
        const pauseForNavigation = () => { navigating = true }
        const interval = window.setInterval(refresh, intervalMs)
        window.addEventListener("focus", refresh)
        window.addEventListener("betelgeze:workspace-navigation-start", pauseForNavigation)
        return () => {
            window.clearInterval(interval)
            window.removeEventListener("focus", refresh)
            window.removeEventListener("betelgeze:workspace-navigation-start", pauseForNavigation)
        }
    }, [intervalMs, router, tabActive])
    return null
}
