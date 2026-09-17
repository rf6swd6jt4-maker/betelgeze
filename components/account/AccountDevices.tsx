"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { NotificationSwitch } from "@/components/ui/NotificationSwitch"
import { PushNotificationSettings } from "./PushNotificationSettings"

export type AccountDevice = { id: string; platform: string; browser: string; mobile: boolean; is_current: boolean; last_seen_at: string | null; notifications_enabled: boolean | null }

export function DeviceCard({ device }: { device: AccountDevice }) {
    return <article className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
        <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-neutral-300">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">{device.mobile ? <><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10 18.5h4" /></> : <><rect x="2.5" y="3.5" width="19" height="13" rx="2" /><path d="M12 16.5v4m-4 0h8" /></>}</svg>
            </div>
            <div className="min-w-0 flex-1"><h3 className="break-words text-sm font-medium">{device.platform} <span className="font-normal text-neutral-500">· {device.browser}</span></h3><p className="mt-1 text-xs text-neutral-400">{device.is_current ? "This device" : "Signed in"}</p></div>
        </div>
        <p className="mt-3 text-xs text-neutral-500">Last seen {device.last_seen_at ? <time dateTime={device.last_seen_at}>{new Date(device.last_seen_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time> : "unavailable"}</p>
        {device.is_current ? <PushNotificationSettings compact /> : <div className="mt-3 border-t border-neutral-800 pt-2">
            <div className="flex items-center justify-between gap-3"><div><p className="text-sm text-neutral-300">Notifications</p><p className="mt-0.5 text-xs text-neutral-500">{device.notifications_enabled === null ? "Not checked yet" : device.notifications_enabled ? "Enabled" : "Disabled"}</p></div><NotificationSwitch checked={device.notifications_enabled === true} disabled label={`Notifications on ${device.platform} (${device.browser}) — change on that device`} /></div>
            {device.notifications_enabled === null ? <p className="mt-1 text-xs leading-5 text-neutral-500">Open Betelgeze on this device to check its setting.</p> : null}
        </div>}
    </article>
}

export function AccountDevices() {
    const [devices, setDevices] = useState<AccountDevice[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [expanded, setExpanded] = useState(false)
    const active = useRef<AbortController | null>(null)
    const load = useCallback(async () => {
        active.current?.abort()
        const controller = new AbortController()
        active.current = controller
        try {
            const response = await fetch("/api/account/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ list: true }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
            const body = await response.json()
            if (!response.ok) throw new Error(body.error ?? "Could not load signed-in devices.")
            if (!controller.signal.aborted) { setDevices(body.devices); setError(null); window.dispatchEvent(new Event("betelgeze:device-observed")) }
        } catch (error) {
            if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load signed-in devices.")
        } finally { if (!controller.signal.aborted) setLoading(false) }
    }, [])
    useEffect(() => {
        // load only updates React state after the network promise settles.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load()
        let lastResume = 0
        const resume = () => { if (document.visibilityState === "visible" && Date.now() - lastResume > 1000) { lastResume = Date.now(); void load() } }
        document.addEventListener("visibilitychange", resume)
        window.addEventListener("focus", resume)
        return () => { active.current?.abort(); document.removeEventListener("visibilitychange", resume); window.removeEventListener("focus", resume) }
    }, [load])
    return <section className="mb-7" aria-labelledby="devices-heading">
        <div className="flex items-center justify-between gap-4"><h2 id="devices-heading" className="text-lg font-semibold">Signed-in devices</h2><button type="button" onClick={() => { setLoading(true); void load() }} disabled={loading} className="min-h-11 px-2 text-sm text-neutral-400 hover:text-white disabled:opacity-40">{loading ? "Checking…" : "Refresh"}</button></div>
        <p className="mt-1 text-sm leading-6 text-neutral-400">Each browser or installed app has its own notification setting. Change a setting on that device.</p>
        {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
        {!devices && loading ? <p role="status" className="mt-4 text-sm text-neutral-500">Loading signed-in devices…</p> : null}
        <div id="signed-in-devices" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">{(expanded ? devices : devices?.slice(0, 2))?.map((device) => <DeviceCard key={device.id} device={device} />)}</div>
        {devices && devices.length > 2 ? <button type="button" aria-expanded={expanded} aria-controls="signed-in-devices" onClick={() => setExpanded(value => !value)} className="mt-2 min-h-11 px-2 text-sm text-neutral-400 hover:text-white">{expanded ? "See less" : `See more (${devices.length - 2})`}</button> : null}
        {expanded && devices?.length === 100 ? <p className="mt-3 text-xs text-neutral-500">Showing the 100 most recently visited devices.</p> : null}
    </section>
}
