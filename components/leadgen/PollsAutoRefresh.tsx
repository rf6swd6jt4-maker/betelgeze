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
        let processing = false
        const tick = async () => {
            if (document.visibilityState !== "visible") return
            if (processUrl && !processing) {
                processing = true
                fetch(processUrl, { method: "POST" })
                    .catch(() => null)
                    .finally(() => {
                        processing = false
                        if (!cancelled) window.setTimeout(() => router.refresh(), 700)
                    })
                return
            }
            router.refresh()
        }
        const initialTimer = window.setTimeout(() => void tick(), 250)
        const timer = window.setInterval(() => void tick(), intervalMs)
        window.addEventListener("focus", tick)
        return () => {
            cancelled = true
            window.clearTimeout(initialTimer)
            window.clearInterval(timer)
            window.removeEventListener("focus", tick)
        }
    }, [enabled, intervalMs, processUrl, router, tabActive])

    return null
}
