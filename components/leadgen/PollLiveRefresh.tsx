"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"

export function PollLiveRefresh({ enabled, intervalMs = 5000 }: { enabled: boolean; intervalMs?: number }) {
    const router = useRouter()
    const tabActive = useWorkspaceTabActive()

    useEffect(() => {
        if (!enabled || !tabActive) return
        const timer = window.setInterval(() => router.refresh(), intervalMs)
        return () => window.clearInterval(timer)
    }, [enabled, intervalMs, router, tabActive])

    return null
}
