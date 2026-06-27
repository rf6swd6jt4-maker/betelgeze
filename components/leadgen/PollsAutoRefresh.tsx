"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export function PollsAutoRefresh({ enabled, intervalMs = 5000, processUrl }: { enabled: boolean; intervalMs?: number; processUrl?: string }) {
    const router = useRouter()
    useEffect(() => {
        if (!enabled) return
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
        void tick()
        const timer = window.setInterval(() => void tick(), intervalMs)
        window.addEventListener("focus", tick)
        return () => {
            cancelled = true
            window.clearInterval(timer)
            window.removeEventListener("focus", tick)
        }
    }, [enabled, intervalMs, processUrl, router])

    return null
}
