"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"

export function ListAutoRefresh({ intervalMs = 8000 }: { intervalMs?: number }) {
    const router = useRouter()
    const tabActive = useWorkspaceTabActive()
    useEffect(() => {
        if (!tabActive) return
        const refresh = () => {
            if (document.visibilityState === "visible") router.refresh()
        }
        const interval = window.setInterval(refresh, intervalMs)
        window.addEventListener("focus", refresh)
        return () => {
            window.clearInterval(interval)
            window.removeEventListener("focus", refresh)
        }
    }, [intervalMs, router, tabActive])
    return null
}
