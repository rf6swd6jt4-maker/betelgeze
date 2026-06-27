"use client"

import { useEffect, useMemo, useState } from "react"

function formatDuration(ms: number) {
    const seconds = Math.max(0, Math.floor(ms / 1000))
    const minutes = Math.floor(seconds / 60)
    const remainder = seconds % 60
    if (minutes <= 0) return `${remainder}s`
    return `${minutes}m ${String(remainder).padStart(2, "0")}s`
}

export function PollDuration({ createdAt, completedAt, live }: { startedAt: string | null; createdAt: string; completedAt: string | null; live: boolean }) {
    const [now, setNow] = useState(() => Date.now())
    const start = useMemo(() => new Date(createdAt).getTime(), [createdAt])
    const end = completedAt ? new Date(completedAt).getTime() : now

    useEffect(() => {
        if (!live) return
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
    }, [live])

    return <span>{formatDuration(end - start)}</span>
}
