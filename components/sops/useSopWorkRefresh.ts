"use client"
import { useEffect, useRef } from "react"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"

/** At most four minutes of reads, and only while a pending run's queue is visible. */
export function useSopWorkRefresh(pending: boolean, visible: boolean, refresh: () => void) {
    const active = useWorkspaceTabActive()
    const until = useRef(0)
    const callback = useRef(refresh)
    useEffect(() => { callback.current = refresh }, [refresh])
    useEffect(() => {
        if (!pending) { until.current = 0; return }
        if (!until.current) until.current = Date.now() + 240_000
        if (!visible || !active) return
        let timer: ReturnType<typeof setTimeout> | undefined
        const schedule = () => {
            clearTimeout(timer)
            if (document.visibilityState !== "visible" || Date.now() >= until.current) return
            timer = setTimeout(() => { callback.current(); schedule() }, 10_000)
        }
        document.addEventListener("visibilitychange", schedule)
        schedule()
        return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", schedule) }
    }, [active, pending, visible])
}
