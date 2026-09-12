"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { QuickStats } from "@/components/panel/QuickStats"
import { Status } from "@/components/ui/Status"
import { PortalSection, portalPrimaryButton } from "./ClientPortalUI"
import type { GhlSummary } from "@/lib/client-portal/ghl-types"

const secondary = "inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)] hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
const field = "mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-black/15 bg-white px-3 py-2.5 text-base text-[var(--onboarding-text,#0F172A)] outline-none focus:border-[var(--onboarding-primary,#1E3A5F)] focus:ring-1 focus:ring-[var(--onboarding-primary,#1E3A5F)]"
const number = (value: number) => value.toLocaleString("en-US")

export function ClientPortalGhl({ token, active }: { token: string; active: boolean }) {
    const [saved, setSaved] = useState<GhlSummary | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [reading, setReading] = useState(true)
    const [pending, setPending] = useState<string | null>(null)
    const [editing, setEditing] = useState(false)
    const [confirmDisconnect, setConfirmDisconnect] = useState(false)
    const [locationId, setLocationId] = useState("")
    const [privateToken, setPrivateToken] = useState("")
    const readController = useRef<AbortController | null>(null)
    const writeController = useRef<AbortController | null>(null)
    const lastRead = useRef(0)
    const generation = useRef(0)
    const mounted = useRef(true)
    const api = `/api/client-portal/session/${token}/connections/ghl`

    const load = useCallback(async () => {
        if (readController.current || writeController.current) return
        const controller = new AbortController()
        readController.current = controller
        const current = generation.current
        lastRead.current = Date.now()
        setReading(true)
        const timeout = window.setTimeout(() => controller.abort(), 25_000)
        try {
            const response = await fetch(api, { cache: "no-store", signal: controller.signal })
            const value = await response.json()
            if (!response.ok) throw new Error(value.error || "The connection could not be loaded.")
            if (mounted.current && current === generation.current) { setSaved(value); setError(null) }
        } catch (problem) {
            if (mounted.current && current === generation.current) setError(problem instanceof Error && problem.name !== "AbortError" ? problem.message : "The connection took too long to load. Please try again.")
        } finally {
            window.clearTimeout(timeout)
            if (readController.current === controller) readController.current = null
            if (mounted.current && current === generation.current) setReading(false)
        }
    }, [api])

    useEffect(() => {
        mounted.current = true
        const requestGeneration = generation
        return () => { mounted.current = false; requestGeneration.current++; readController.current?.abort(); readController.current = null; lastRead.current = 0; writeController.current?.abort() }
    }, [])
    useEffect(() => {
        const refreshStatus = () => {
            if (active && document.visibilityState === "visible" && Date.now() - lastRead.current > 60_000) void load()
        }
        refreshStatus()
        window.addEventListener("focus", refreshStatus)
        document.addEventListener("visibilitychange", refreshStatus)
        return () => { window.removeEventListener("focus", refreshStatus); document.removeEventListener("visibilitychange", refreshStatus) }
    }, [active, load])

    async function mutate(action: "connect" | "refresh" | "disconnect") {
        if (writeController.current) return
        generation.current++
        readController.current?.abort()
        readController.current = null
        setReading(false)
        const controller = new AbortController()
        writeController.current = controller
        setPending(action); setError(null)
        const timeout = window.setTimeout(() => controller.abort(), 35_000)
        try {
            const response = await fetch(api, {
                method: "POST", cache: "no-store", signal: controller.signal,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, ...(action === "connect" ? { locationId, privateToken } : {}) }),
            })
            const value = await response.json()
            if (!response.ok) throw new Error(value.error || "The connection could not be saved.")
            if (!mounted.current) return
            setSaved(value); setEditing(false); setConfirmDisconnect(false)
            setPrivateToken(""); lastRead.current = Date.now()
        } catch (problem) {
            if (mounted.current) setError(problem instanceof Error && problem.name !== "AbortError" ? problem.message : "The request did not finish in this browser. Reload its status to check whether it completed.")
        } finally {
            window.clearTimeout(timeout)
            writeController.current = null
            if (mounted.current) setPending(null)
        }
    }
    function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void mutate("connect") }
    const metrics = saved?.metrics
    const connected = saved?.connected === true
    const beginEditing = () => { setLocationId(saved?.locationId ?? locationId); setEditing(true); setConfirmDisconnect(false) }

    return <PortalSection id="ghl-connection" title="GHL" description="Contacts & opportunities" icon="connection">
        <div className="mt-4 min-w-0" aria-busy={Boolean(pending)}>
            <Status surface="light" tone={connected ? "green" : "grey"} wrap label={saved?.busy ? "Update in progress…" : connected ? "Connected" : reading || !saved ? "Checking connection…" : "Not connected"} />
            {connected ? <p className="mt-2 break-words text-sm font-medium">{saved.locationName}</p> : <p className="mt-3 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Connect your GHL sub-account to see your contacts and opportunity results here.</p>}
            {metrics ? <>
                <QuickStats surface="light" ariaLabel="GHL opportunity metrics" items={[
                    { label: "Open", value: number(metrics.open) }, { label: "Won", value: number(metrics.won) }, { label: "Lost", value: number(metrics.lost) },
                ]} />
                <p className="mt-4 text-sm"><strong className="font-semibold tabular-nums">{number(metrics.contacts)}</strong> contacts <span aria-hidden="true" className="px-1 text-black/25">·</span> <strong className="font-semibold tabular-nums">{number(metrics.opportunities)}</strong> opportunities</p>
                <p className="mt-2 text-xs leading-5 text-[var(--onboarding-muted,#475569)]">Current totals across all pipelines, with no date filter. Opportunity counts may include multiple deals per contact and abandoned deals.</p>
                {saved?.refreshedAt ? <p className="mt-2 text-xs leading-5 text-[var(--onboarding-muted,#475569)]">Updated {new Date(saved.refreshedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. Refresh to update.</p> : null}
            </> : null}
            {error || saved?.error ? <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-800"><p>{error || saved?.error}</p><button type="button" className={`${secondary} mt-1`} disabled={Boolean(pending) || reading} onClick={() => void load()}>Reload status</button></div> : null}
            {editing ? <form onSubmit={submit} className="mt-4 space-y-4">
                <div><label htmlFor="ghl-location-id" className="text-sm font-medium">Location ID</label><input id="ghl-location-id" className={field} value={locationId} onChange={(event) => setLocationId(event.target.value)} autoComplete="off" spellCheck={false} maxLength={80} required disabled={Boolean(pending)} /></div>
                <div><label htmlFor="ghl-private-token" className="text-sm font-medium">Private Integration Token</label><input id="ghl-private-token" type="password" className={field} value={privateToken} onChange={(event) => setPrivateToken(event.target.value)} autoComplete="new-password" spellCheck={false} maxLength={4096} required disabled={Boolean(pending)} /><p className="mt-1.5 text-xs leading-5 text-[var(--onboarding-muted,#475569)]">Saved securely for this client only. It will not be displayed again.</p></div>
                <details className="text-sm leading-6 text-[var(--onboarding-muted,#475569)]"><summary className="min-h-11 cursor-pointer py-2 font-medium text-[var(--onboarding-primary,#1E3A5F)]">Where to find these details</summary><ol className="list-decimal space-y-2 pl-5"><li>Open the client’s GHL sub-account. Copy its Location ID from Settings → Business Profile.</li><li>In Settings → Private Integrations, create an integration named Betelgeze.</li><li>Allow read access to Contacts, Opportunities, and Locations (sub-accounts): <code className="break-all text-xs">contacts.readonly</code>, <code className="break-all text-xs">opportunities.readonly</code>, <code className="break-all text-xs">locations.readonly</code>.</li><li>Copy the token and paste it above.</li></ol></details>
                <div className="flex flex-wrap gap-2"><button type="submit" className={portalPrimaryButton} disabled={Boolean(pending) || !saved}>{pending === "connect" ? "Connecting…" : connected ? "Replace connection" : "Connect GHL"}</button><button type="button" className={secondary} disabled={Boolean(pending)} onClick={() => { setEditing(false); setPrivateToken("") }}>Cancel</button></div>
            </form> : <div className="mt-4 flex flex-wrap items-center gap-1">
                {connected ? <><button type="button" className={portalPrimaryButton} disabled={Boolean(pending)} onClick={() => void mutate("refresh")}>{pending === "refresh" ? "Refreshing…" : "Refresh metrics"}</button><button type="button" className={secondary} disabled={Boolean(pending)} onClick={beginEditing}>Manage connection</button></> : <><button type="button" className={portalPrimaryButton} disabled={Boolean(pending) || !saved} onClick={beginEditing}>Connect GHL</button></>}
            </div>}
            {connected && editing ? <div className="mt-4 border-t border-black/10 pt-2">{confirmDisconnect ? <><p className="mt-2 text-sm">Disconnect GHL and remove its saved metrics from this portal?</p><div className="flex flex-wrap gap-2"><button type="button" className={`${secondary} text-red-700`} disabled={Boolean(pending)} onClick={() => void mutate("disconnect")}>{pending === "disconnect" ? "Disconnecting…" : "Confirm disconnect"}</button><button type="button" className={secondary} disabled={Boolean(pending)} onClick={() => setConfirmDisconnect(false)}>Keep connected</button></div></> : <button type="button" className={`${secondary} text-red-700`} disabled={Boolean(pending)} onClick={() => setConfirmDisconnect(true)}>Disconnect GHL</button>}</div> : null}
        </div>
    </PortalSection>
}
