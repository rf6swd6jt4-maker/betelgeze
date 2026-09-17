"use client"

import { useEffect, useRef, useState } from "react"
import { NotificationSwitch } from "@/components/ui/NotificationSwitch"
import { browserPushManager, pushApplicationServerKey } from "@/lib/push/browser-push-manager"
import { subscriptionFingerprint } from "@/lib/push/subscription-fingerprint"

type PushSettingsResponse = {
    configured?: boolean
    publicKey?: string | null
    subscribed?: boolean
    fingerprint?: string | null
    error?: string
}

type State = "loading" | "off" | "on" | "saving" | "blocked" | "install" | "unsupported" | "unavailable" | "error"

function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

export function PushNotificationSettings({ compact = false }: { compact?: boolean }) {
    const mutation = useRef(false)
    const inspection = useRef(0)
    const [retry, setRetry] = useState(0)
    const [confirmedEnabled, setConfirmedEnabled] = useState(false)
    const [state, setState] = useState<State>("loading")
    const [publicKey, setPublicKey] = useState<string | null>(null)
    const [detail, setDetail] = useState("Checking this device…")

    useEffect(() => {
        let cancelled = false
        async function inspect() {
            if (mutation.current) return
            const version = ++inspection.current
            if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
                if (!cancelled) { setState("unsupported"); setDetail("This browser does not support Web Push notifications.") }
                return
            }
            if (isIos() && !isStandalone()) {
                if (!cancelled) { setState("install"); setDetail("Add Betelgeze to your Home Screen, open the installed app, then enable notifications here.") }
                return
            }
            const response = await fetch("/api/push/subscriptions", { signal: AbortSignal.timeout(10_000), cache: "no-store" })
            const result = await response.json().catch(() => null) as PushSettingsResponse | null
            if (cancelled || version !== inspection.current || mutation.current) return
            if (!response.ok) { setState("error"); setDetail(result?.error ?? "Could not check notification settings."); return }
            if (!result?.configured || !result.publicKey) { setState("unavailable"); setDetail("Chat notifications are not configured on this Betelgeze deployment yet."); return }
            setPublicKey(result.publicKey)
            const pushManager = browserPushManager() ?? browserPushManager(await navigator.serviceWorker.getRegistration("/"))
            const browserSubscription = await pushManager?.getSubscription()
            if (cancelled || version !== inspection.current || mutation.current) return
            if (Notification.permission === "denied") {
                setConfirmedEnabled(false)
                setState("blocked")
                setDetail("Notifications are blocked. Allow Betelgeze in this device’s settings, then select the toggle again to finish enabling them.")
                return
            }
            const matches = browserSubscription && result.fingerprint === await subscriptionFingerprint(browserSubscription.toJSON())
            if (cancelled || version !== inspection.current || mutation.current) return
            if (Notification.permission === "granted" && result.subscribed && matches) {
                setConfirmedEnabled(true)
                setState("on")
                setDetail("Notifications stay on when you close or quit Betelgeze. Log out pauses delivery; your next sign-in resumes it.")
                return
            }
            setConfirmedEnabled(false)
            setState("off")
            setDetail(Notification.permission === "granted" ? "Notification permission is allowed. Select the toggle to finish enabling chats on this device." : "Enable notifications for chats on this device.")
        }
        const refresh = () => {
            if (document.visibilityState !== "visible" || mutation.current) return
            const pending = inspect()
            const version = inspection.current
            void pending.catch(() => { if (!cancelled && version === inspection.current && !mutation.current) { setState("error"); setDetail("Could not check notification settings.") } })
        }
        refresh()
        window.addEventListener("focus", refresh)
        window.addEventListener("pageshow", refresh)
        window.addEventListener("betelgeze:push-setting-changed", refresh)
        document.addEventListener("visibilitychange", refresh)
        return () => {
            cancelled = true
            window.removeEventListener("focus", refresh)
            window.removeEventListener("pageshow", refresh)
            window.removeEventListener("betelgeze:push-setting-changed", refresh)
            document.removeEventListener("visibilitychange", refresh)
        }
    }, [retry])

    async function enable() {
        if (mutation.current) return
        if (!publicKey) { setState("loading"); setRetry((value) => value + 1); return }
        if (Notification.permission === "denied") {
            setState("blocked")
            setDetail("Notifications are blocked. Allow Betelgeze in this device’s settings, then select the toggle again to finish enabling them.")
            return
        }
        mutation.current = true
        inspection.current++
        setState("saving")
        setDetail(Notification.permission === "default" ? "Opening this device’s notification permission prompt…" : "Enabling notifications on this device…")
        try {
            let pushManager = browserPushManager()
            if (!pushManager) {
                const registration = await navigator.serviceWorker.getRegistration("/") ?? await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
                pushManager = registration.pushManager
            }
            const existing = await pushManager.getSubscription()
            const subscription = existing ?? await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushApplicationServerKey(publicKey) })
            const response = await fetch("/api/push/subscriptions", { signal: AbortSignal.timeout(10_000), method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription) })
            const result = await response.json().catch(() => null) as PushSettingsResponse | null
            if (!response.ok) throw new Error(result?.error ?? "Could not save this device.")
            setConfirmedEnabled(true)
                setState("on")
            setDetail("Notifications stay on when you close or quit Betelgeze. Log out pauses delivery; your next sign-in resumes it.")
        } catch (error) {
            if (error instanceof DOMException && error.name === "NotAllowedError") {
                setState("blocked")
                setDetail("Notifications are still blocked. Allow Betelgeze in this device’s settings, return here, then select the toggle again.")
                return
            }
            setState("error")
            setDetail(error instanceof Error ? error.message : "Could not enable notifications on this device.")
        } finally { mutation.current = false }
    }

    async function disable() {
        if (mutation.current) return
        mutation.current = true
        inspection.current++
        setState("saving")
        setDetail("Disabling notifications on this device…")
        try {
            const response = await fetch("/api/push/subscriptions", { signal: AbortSignal.timeout(10_000), method: "DELETE" })
            const result = await response.json().catch(() => null) as PushSettingsResponse | null
            if (!response.ok) throw new Error(result?.error ?? "Could not disable this device.")
            // Server deletion is authoritative. Browser cleanup failure cannot
            // turn an acknowledged off setting into an apparent failed save.
            try {
                const pushManager = browserPushManager() ?? browserPushManager(await navigator.serviceWorker.getRegistration("/"))
                const subscription = await pushManager?.getSubscription()
                if (subscription) await subscription.unsubscribe()
            } catch { /* Reconciliation never restores a deleted server row. */ }
            setConfirmedEnabled(false)
            setState("off")
            setDetail("Enable notifications for chats on this device.")
        } catch (error) {
            setState("error")
            setDetail(error instanceof Error ? error.message : "Could not disable notifications on this device.")
        } finally { mutation.current = false }
    }

    const enabled = confirmedEnabled
    const disabled = state === "loading" || state === "saving" || state === "install" || state === "unsupported" || state === "unavailable"
    return <section className={compact ? "mt-3 border-t border-neutral-800 pt-2" : "mt-7 border-t border-neutral-800 pt-5"}>
        <div className="flex items-center justify-between gap-5">
            <div>
                <h3 className={compact ? "text-sm text-neutral-300" : "font-medium"}>{compact ? "Notifications" : "Chat notifications"}</h3>
                {compact ? <p className="mt-0.5 text-xs text-neutral-500">{state === "on" ? "Enabled" : state === "off" ? "Disabled" : state === "saving" ? "Saving…" : state === "loading" ? "Checking…" : state === "blocked" ? "Blocked by device" : "Needs attention"}</p> : <p className="mt-1 text-sm text-neutral-400">Native and incoming WhatsApp chats. Notification previews show the chat name and message.</p>}
            </div>
            <NotificationSwitch checked={enabled} disabled={disabled} label="Chat notifications on this device" onChange={() => enabled ? void disable() : void enable()} />
        </div>
        <p role="status" className={`${compact ? "mt-1 text-xs leading-5" : "mt-3 text-sm"} ${state === "error" || state === "blocked" ? "text-red-300" : "text-neutral-500"}`}>{compact && (state === "on" || state === "off") ? null : detail}</p>
    </section>
}
