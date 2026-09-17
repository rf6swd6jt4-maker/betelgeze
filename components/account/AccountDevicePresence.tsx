"use client"

import { useEffect } from "react"

// One lightweight, post-paint observation per foreground/resume, at most every
// five minutes. No polling, history read, hidden-frame work or launch gate.
export function AccountDevicePresence() {
    useEffect(() => {
        if (window.top !== window) return
        let lastAttempt = 0
        const controller = new AbortController()
        const record = () => {
            if (window.location.pathname.endsWith("/security") || document.visibilityState !== "visible" || Date.now() - lastAttempt < 300_000) return
            lastAttempt = Date.now()
            void fetch("/api/account/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) }).catch(() => undefined)
        }
        record()
        window.addEventListener("focus", record)
        document.addEventListener("visibilitychange", record)
        return () => { controller.abort(); window.removeEventListener("focus", record); document.removeEventListener("visibilitychange", record) }
    }, [])
    return null
}
