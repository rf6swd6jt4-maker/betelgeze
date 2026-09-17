"use client"

import { useEffect } from "react"

// One post-paint observation per foreground visit; paired events coalesce.
// No polling, history read, hidden-frame work or launch gate.
export function AccountDevicePresence() {
    useEffect(() => {
        if (window.top !== window) return
        let lastAttempt = 0
        let inFlight = false
        let pending = false
        const controller = new AbortController()
        const record = () => {
            if (controller.signal.aborted || window.location.pathname.endsWith("/security") || document.visibilityState !== "visible" || Date.now() - lastAttempt < 1_000) return
            if (inFlight) { pending = true; return }
            inFlight = true
            lastAttempt = Date.now()
            void fetch("/api/account/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) }).then(response => { if (response.ok && !controller.signal.aborted) window.dispatchEvent(new Event("betelgeze:device-observed")) }).catch(() => undefined).finally(() => { inFlight = false; if (pending) { pending = false; record() } })
        }
        record()
        window.addEventListener("focus", record)
        document.addEventListener("visibilitychange", record)
        return () => { controller.abort(); window.removeEventListener("focus", record); document.removeEventListener("visibilitychange", record) }
    }, [])
    return null
}
