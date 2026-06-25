"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export function ListAutoRefresh({ intervalMs = 8000 }: { intervalMs?: number }) {
    const router = useRouter()
    useEffect(() => {
        const refresh = () => {
            if (document.visibilityState === "visible") router.refresh()
        }
        const interval = window.setInterval(refresh, intervalMs)
        window.addEventListener("focus", refresh)
        return () => {
            window.clearInterval(interval)
            window.removeEventListener("focus", refresh)
        }
    }, [intervalMs, router])
    return null
}
