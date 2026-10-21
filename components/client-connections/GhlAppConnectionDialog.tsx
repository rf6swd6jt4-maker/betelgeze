"use client"

import { GhlCalendarPicker } from "./GhlCalendarPicker"

import { useEffect, useRef, useState } from "react"
import { CenteredDialog, Selector, Status } from "@/components/ui"
import type { ClientConnectionAccount } from "@/lib/client-connections"

type Choice = { id: string; name: string; isActive?: boolean }
type Session = { relationshipId: string; phase: string; locations: Choice[]; limited: boolean; locationId: string | null; calendars: Choice[] }
type Notifications = { ready: boolean; sendingEnabled: boolean; consentReady: boolean; reminderMinutes: number; calendars?: Choice[]; error?: string }
type Connected = { connected: true; revision: string; notifications: Notifications }
const button = "min-h-11 w-full rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
const field = "mt-2 h-11 w-full rounded-xl border border-neutral-700 bg-black px-3 text-sm text-white outline-none focus:border-neutral-400"

export function GhlAppConnectionDialog({ workspaceSlug, accounts, initialAccount, initialChoices, resume = false, onClose, onManual, onSaved }: {
    workspaceSlug: string; accounts: ClientConnectionAccount[]; initialAccount?: ClientConnectionAccount; initialChoices?: ClientConnectionAccount[]; resume?: boolean
    onClose: () => void; onManual: (account: ClientConnectionAccount | null) => void; onSaved: () => void
}) {
    const [openingChoices] = useState(initialChoices ?? (resume ? accounts : accounts.filter(account => !account.connected)))
    const [relationshipId, setRelationshipId] = useState(initialAccount?.relationshipId ?? (resume ? "" : openingChoices[0]?.relationshipId) ?? "")
    const [phase, setPhase] = useState<"start" | "location" | "calendar" | "connected">(initialAccount?.connected ? "connected" : "start")
    const [revision, setRevision] = useState(initialAccount?.revision ?? null)
    const [locations, setLocations] = useState<Choice[]>([]), [locationId, setLocationId] = useState("")
    const [limited, setLimited] = useState(false), [exactLocation, setExactLocation] = useState("")
    const [calendars, setCalendars] = useState<Choice[]>([]), [calendarIds, setCalendarIds] = useState<string[]>([])
    const [editingSaved, setEditingSaved] = useState(false)
    const saveRequestId = useRef<string | null>(null)
    const [savePending, setSavePending] = useState(false)
    const [notifications, setNotifications] = useState<Notifications | null>(null)
    const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(resume || Boolean(initialAccount?.connected && initialAccount.revision))
    const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null)
    const [recoveryNeeded, setRecoveryNeeded] = useState(resume)
    const currentRequest = useRef<AbortController | null>(null), mounted = useRef(true)
    const recoveryRequest = useRef<Promise<void> | null>(null)
    const returnChannel = useRef<BroadcastChannel | null>(null)
    const authorizationWindow = useRef<Window | null>(null)
    const account = accounts.find(item => item.relationshipId === relationshipId)
    const endpoint = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/client-connections/oauth`

    async function request<T>(body?: Record<string, unknown>, query = ""): Promise<T> {
        if (currentRequest.current) throw new Error("A connection step is already running.")
        const controller = new AbortController(); currentRequest.current = controller
        let timedOut = false
        const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 100_000)
        setBusy(true); setError(null)
        try {
            const response = await fetch(endpoint + query, { method: body ? "POST" : "GET", cache: "no-store", signal: controller.signal,
                ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error ?? "This connection step could not be completed.")
            if (controller.signal.aborted || !mounted.current) throw new DOMException("The connection view closed.", "AbortError")
            return result as T
        } catch (error) {
            if (timedOut) throw new Error("The request timed out. Resume the connection to check what was saved before trying again.")
            throw error
        } finally {
            clearTimeout(timeout)
            if (currentRequest.current === controller) { currentRequest.current = null; if (mounted.current) setBusy(false) }
        }
    }
    function report(value: unknown) {
        if (value instanceof Error && value.name === "AbortError") return
        if (mounted.current) setError(value instanceof Error && value.name !== "AbortError" ? value.message : "The request timed out. Check the saved connection before trying again.")
    }
    async function status(id: string, expectedRevision: string) {
        const query = new URLSearchParams({ action: "notification_status", relationshipId: id, expectedRevision })
        setNotifications(await request<Notifications>(undefined, `?${query}`))
    }
    function recover() {
        if (recoveryRequest.current) return recoveryRequest.current
        const pending = (async () => {
            try {
                const session = await request<Session>()
                const selected = accounts.find(item => item.relationshipId === session.relationshipId)
                if (!selected) throw new Error("This client is no longer available. Close this window and reload Client Connections.")
                setRelationshipId(session.relationshipId); setRevision(selected.revision ?? null)
                if (["authorizing", "exchanging"].includes(session.phase)) {
                    setRecoveryNeeded(true)
                    throw new Error("Complete authorisation in HighLevel, then resume this connection.")
                }
                setRecoveryNeeded(false); setAuthorizationUrl(null)
                if (session.phase === "ready") {
                    setLocations(session.locations); setLocationId(session.locations.length === 1 ? session.locations[0].id : ""); setLimited(session.limited); setPhase("location")
                } else if (session.phase === "selected") {
                    setLocationId(session.locationId ?? ""); setCalendars(session.calendars); setCalendarIds(session.calendars.length === 1 ? [session.calendars[0].id] : []); setPhase("calendar")
                } else if (session.phase === "done") {
                    const result = await request<Connected>({ action: "connect" })
                    setRevision(result.revision); setNotifications(result.notifications); setPhase("connected"); onSaved()
                } else {
                    setPhase("start")
                    throw new Error("HighLevel authorisation was not completed. Start a new connection attempt.")
                }
            } catch (error) { report(error) }
        })()
        recoveryRequest.current = pending
        void pending.finally(() => { if (recoveryRequest.current === pending) recoveryRequest.current = null })
        return pending
    }
    useEffect(() => {
        mounted.current = true
        let current = true
        // The microtask avoids issuing a duplicate read during Strict Mode's
        // setup/cleanup probe. Loading already belongs to the opening state.
        void Promise.resolve().then(() => {
            if (!current) return
            if (resume) void recover()
            else if (initialAccount?.connected && initialAccount.revision) void status(initialAccount.relationshipId, initialAccount.revision).catch(report)
        })
        return () => { current = false; mounted.current = false; currentRequest.current?.abort(); currentRequest.current = null; returnChannel.current?.close(); returnChannel.current = null }
        // The dialog has one opening identity. Later account refreshes must not
        // restart an accepted OAuth step or overwrite the user's calendar choice.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function editCalendars() {
        try {
            const result = await request<{ calendars: Choice[]; selectedCalendarIds: string[]; revision: string }>(undefined, `?${new URLSearchParams({ action: "calendars", relationshipId, expectedRevision: revision! })}`)
            setCalendars(result.calendars); setCalendarIds(result.selectedCalendarIds); setRevision(result.revision); setEditingSaved(true); saveRequestId.current = null; setSavePending(false); setPhase("calendar"); setRecoveryNeeded(false)
        } catch (error) { report(error) }
    }
    async function start() {
        setEditingSaved(false); saveRequestId.current = null; setSavePending(false)
        if (!account || currentRequest.current) return
        // Open synchronously from the click, preserving the current workspace's
        // tabs/drafts. If popups are blocked, show an ordinary link instead.
        const popup = window.open("about:blank", "_blank")
        if (popup) popup.opener = null
        authorizationWindow.current = popup
        try {
            const result = await request<{ authorizationUrl?: string; channel?: string; resume?: boolean }>({ action: "start", relationshipId, expectedRevision: account.revision ?? null })
            if (result.resume) { popup?.close(); await recover(); return }
            if (!result.authorizationUrl || !result.channel || !/^[a-f0-9]{64}$/.test(result.channel)) throw new Error("The HighLevel authorisation link is unavailable.")
            const url = new URL(result.authorizationUrl)
            if (url.origin !== "https://marketplace.gohighlevel.com" || !["/oauth/chooselocation", "/v2/oauth/chooselocation"].includes(url.pathname)) throw new Error("The HighLevel authorisation link is unavailable.")
            setAuthorizationUrl(url.toString())
            setRecoveryNeeded(true)
            returnChannel.current?.close()
            if (typeof BroadcastChannel !== "undefined") {
                const channel = new BroadcastChannel(`be-ghl:${result.channel}`)
                returnChannel.current = channel
                let received = false
                channel.onmessage = event => {
                    if (event.data?.type !== "complete" || received || !mounted.current) return
                    received = true
                    void recover().finally(() => {
                        try { channel.postMessage({ type: "received" }) } catch { /* The dialog may have closed while reading. */ }
                        channel.close()
                        if (returnChannel.current === channel) returnChannel.current = null
                        authorizationWindow.current?.close(); authorizationWindow.current = null
                        if (mounted.current) window.top?.focus()
                    })
                }
            }
            if (popup && !popup.closed) popup.location.replace(url.toString())
        } catch (error) { if (popup && !popup.closed) popup.close(); report(error) }
    }
    async function selectLocation() {
        try {
            const chosen = exactLocation.trim() || locationId
            const result = await request<{ calendars: Choice[]; locationId: string }>({ action: "select", locationId: chosen })
            setLocationId(result.locationId); setCalendars(result.calendars); setCalendarIds(result.calendars.length === 1 ? [result.calendars[0].id] : []); setPhase("calendar")
        } catch (error) { setRecoveryNeeded(true); report(error) }
    }
    async function connect() {
        try {
            if (editingSaved) { saveRequestId.current ??= crypto.randomUUID(); setSavePending(true) }
            const result = await request<Connected>(editingSaved ? { action: "save_calendars", calendarIds, relationshipId, expectedRevision: revision, requestId: saveRequestId.current } : { action: "connect", calendarIds })
            setRevision(result.revision); setNotifications(result.notifications); setPhase("connected"); saveRequestId.current = null; setSavePending(false); onSaved()
        } catch (error) { if (!editingSaved) setRecoveryNeeded(true); report(error) }
    }
    async function checkNotificationSetup() {
        try { setNotifications(await request<Notifications>({ action: "prepare_notifications", relationshipId, expectedRevision: revision })) }
        catch (error) { report(error) }
    }
    async function toggleNotifications(enable: boolean) {
        try {
            const result = await request<Notifications>({ action: enable ? "enable_notifications" : "disable_notifications", relationshipId, expectedRevision: revision })
            setNotifications(current => enable ? result : current ? { ...current, sendingEnabled: false } : null)
        } catch (error) { report(error) }
    }
    const choices = openingChoices.some(item => item.relationshipId === relationshipId) || !account ? openingChoices : [account, ...openingChoices]
    return <CenteredDialog title="Connect HighLevel" busy={busy} onClose={onClose}>
        <div className="space-y-4">
            {phase === "start" && !initialAccount ? <label className="block text-sm text-neutral-300">Client<Selector name="relationshipId" ariaLabel="Client for HighLevel" appearance="input" value={relationshipId} disabled={busy || !!authorizationUrl} onChange={value => { setRelationshipId(value); setAuthorizationUrl(null); setError(null) }} options={choices.map(item => ({ value: item.relationshipId, label: item.businessName ? `${item.clientName} – ${item.businessName}` : item.clientName }))} /></label> : <p className="text-sm text-neutral-300">{account?.businessName ? `${account.clientName} – ${account.businessName}` : account?.clientName ?? "Loading client…"}</p>}
            {busy ? <p role="status" className="text-sm text-neutral-400">Checking the connection…</p> : null}
            {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
            {error && authorizationUrl ? <button type="button" disabled={busy} onClick={() => { returnChannel.current?.close(); returnChannel.current = null; authorizationWindow.current?.close(); authorizationWindow.current = null; setAuthorizationUrl(null); setRecoveryNeeded(false); setPhase("start"); setError(null) }} className="min-h-11 text-sm underline underline-offset-4">Start again</button> : null}
            {recoveryNeeded ? <button type="button" disabled={busy} onClick={() => void recover()} className="min-h-11 text-sm underline underline-offset-4">Resume connection</button> : null}
            {!authorizationUrl && (phase === "start" || (phase === "connected" && !notifications?.ready)) ? <>
                <p className="text-sm leading-6 text-neutral-400">Continue an unfinished setup, or authorise an existing HighLevel installation. A temporary window opens for authorisation, then calendar selection continues here.</p>
                <button type="button" className={button} disabled={busy || !account} onClick={() => void start()}>{busy ? "Preparing…" : "Connect HighLevel"}</button>
            </> : null}
            {authorizationUrl ? <p className="text-sm leading-6 text-neutral-300">Finish authorising in the new tab. If it did not open, <a href={authorizationUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">continue to HighLevel</a>.</p> : null}
            {phase === "location" ? <>
                <label className="block text-sm text-neutral-300">HighLevel sub-account<Selector ariaLabel="HighLevel sub-account" appearance="input" value={locationId} disabled={busy} onChange={value => { setLocationId(value); setExactLocation("") }} options={locations.map(item => ({ value: item.id, label: item.name }))} /></label>
                {limited ? <label className="block text-sm text-neutral-300">Another installed sub-account<p className="mt-1 text-xs text-neutral-400">Showing the first 50. Enter the Location ID if yours is not listed.</p><input aria-label="Installed Location ID" className={field} value={exactLocation} disabled={busy} onChange={event => setExactLocation(event.target.value)} /></label> : null}
                <button type="button" className={button} disabled={busy || !(locationId || exactLocation.trim())} onClick={() => void selectLocation()}>Choose calendar</button>
            </> : null}
            {phase === "calendar" ? <>
                <div className="text-sm text-neutral-300">Client portal calendars<GhlCalendarPicker calendars={calendars} value={calendarIds} disabled={busy || savePending} onChange={setCalendarIds} /></div>
                <p className="text-sm leading-6 text-neutral-400">Inactive/draft calendars can be selected for existing appointments. This does not activate them in HighLevel.</p>
                <p className="text-sm leading-6 text-neutral-400">Clients can switch between the selected calendars in their portal. Saving turns notifications off until you enable them for this selection in the next step.</p>
                <button type="button" className={button} disabled={busy || !calendarIds.length} onClick={() => void connect()}>{savePending ? "Check and retry save" : "Save calendar connection"}</button>
            </> : null}
            {phase === "connected" ? <section className="space-y-3 border-t border-neutral-800 pt-4">
                <Status label={notifications?.ready ? "App calendar connected" : (calendarIds.length || account?.calendarId ? "Calendar saved — app setup unfinished" : "Account saved — app setup unfinished")} tone={notifications?.ready ? "green" : "grey"} />
                {notifications?.calendars?.length ? <p className="text-sm text-neutral-300">Calendars: {notifications.calendars.map(item => item.name).join(", ")}</p> : null}
                <button type="button" disabled={busy} onClick={() => void editCalendars()} className="block min-h-11 text-sm underline underline-offset-4">Edit calendars</button>
                <h3 className="font-semibold">WhatsApp notifications</h3>
                <p className="text-sm leading-6 text-neutral-400">Send booking, reschedule, cancellation, removal, detail and status updates, plus an appointment reminder, from all selected calendars to this client’s confirmed WhatsApp number.</p>
                {notifications?.error ? <p role="alert" className="text-sm text-yellow-200">{notifications.error}</p> : null}
                {notifications?.ready ? <>
                    <Status label={notifications.sendingEnabled ? "Notifications enabled" : "Notifications off"} tone={notifications.sendingEnabled ? "green" : "grey"} />
                    <p className="text-sm text-neutral-400">Reminder: {notifications.reminderMinutes} minutes before the appointment.</p>
                    {!notifications.consentReady ? <p className="text-sm text-yellow-200">Confirm this client’s WhatsApp number before enabling notifications.</p> : null}
                    <button type="button" className={button} disabled={busy || (!notifications.sendingEnabled && !notifications.consentReady)} onClick={() => void toggleNotifications(!notifications.sendingEnabled)}>{notifications.sendingEnabled ? "Turn off WhatsApp notifications" : "Enable WhatsApp notifications"}</button>
                </> : null}
                <button type="button" disabled={busy} onClick={() => void checkNotificationSetup()} className="block min-h-11 text-sm underline underline-offset-4">Check notification setup</button>
                <button type="button" disabled={busy || !!authorizationUrl} onClick={() => { setPhase("start"); setError(null) }} className="block min-h-11 text-sm underline underline-offset-4">Reconnect HighLevel</button>
            </section> : null}
            <div className="flex flex-wrap justify-between gap-3 border-t border-neutral-800 pt-3">
                <button type="button" disabled={busy} onClick={() => onManual(account ?? null)} className="min-h-11 text-sm text-neutral-400 underline underline-offset-4">Manual connection{account?.connected ? " and retirement" : ""}</button>
                <button type="button" disabled={busy} onClick={onClose} className="min-h-11 px-3 text-sm">Close</button>
            </div>
        </div>
    </CenteredDialog>
}
