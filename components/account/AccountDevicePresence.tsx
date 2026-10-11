"use client"

import { useEffect } from "react"

// One post-paint observation per foreground visit; paired events coalesce.
// Explicit binding recovery uses this same serialized owner.
// No polling, history read, hidden-frame work or launch gate.
export function AccountDevicePresence() {
    useEffect(() => {
        if (window.top !== window) return
        let lastAttempt = 0
        let inFlight = false
        let pending = false
        const controller = new AbortController()
        const record = (recovery = false) => {
            if (controller.signal.aborted || window.location.pathname.endsWith("/security") || document.visibilityState !== "visible") return
            if (!recovery && Date.now() - lastAttempt < 1_000) return
            if (inFlight) { if (!recovery) pending = true; return }
            inFlight = true
            lastAttempt = Date.now()
            void fetch("/api/account/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) }).then(response => { if (response.ok && !controller.signal.aborted) window.dispatchEvent(new Event("betelgeze:device-observed")) }).catch(() => undefined).finally(() => {
                inFlight = false
                if (pending) { pending = false; record() }
            })
        }
        const visit = () => record()
        const recover = () => record(true)
        record()
        window.addEventListener("focus", visit)
        window.addEventListener("betelgeze:device-observation-required", recover)
        document.addEventListener("visibilitychange", visit)
        return () => {
            controller.abort()
            window.removeEventListener("focus", visit)
            window.removeEventListener("betelgeze:device-observation-required", recover)
            document.removeEventListener("visibilitychange", visit)
        }
    }, [])
    return null
}
