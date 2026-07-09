"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"

export function DashboardAutoRefresh() {
    const router = useRouter()
    const tabActive = useWorkspaceTabActive()
    useEffect(() => {
        if (!tabActive) return
        const refresh = () => {
            if (document.visibilityState === "visible") router.refresh()
        }
        const interval = window.setInterval(refresh, 8000)
        window.addEventListener("focus", refresh)
        return () => {
            window.clearInterval(interval)
            window.removeEventListener("focus", refresh)
        }
    }, [router, tabActive])
    return null
}
