"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CenteredDialog, Status } from "@/components/ui"
import { formatGoogleAdsCustomerId, googleAdsOnboardingResponse, type GoogleAdsOnboardingConnection } from "@/lib/onboarding/google-ads-state"

export function GoogleAdsConnectionDialog({ workspaceSlug, relationshipId, clientName, onClose, onSaved }: { workspaceSlug: string; relationshipId: string; clientName: string; onClose: () => void; onSaved: () => void }) {
    const [connection, setConnection] = useState<GoogleAdsOnboardingConnection | null>(null)
    const [customerId, setCustomerId] = useState("")
    const [manager, setManager] = useState<{ id: string; name: string } | null>(null)
    const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null)
    const [ready, setReady] = useState(false)
    const request = useRef<AbortController | null>(null), writing = useRef(false)
    const endpoint = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/client-connections/google-ads`
    const load = useCallback(async (mutationError?: string) => {
        request.current?.abort(); const controller = new AbortController(); request.current = controller
        setLoading(true); setError(mutationError ?? null); setReady(false)
        try {
            const response = await fetch(`${endpoint}?relationship=${relationshipId}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) })
            const value = await response.json()
            if (request.current !== controller || controller.signal.aborted) return
            if (response.status === 401 || response.status === 403) { setConnection(null); setCustomerId(""); setManager(null) }
            if (!response.ok) throw new Error(value.error || "Google Ads setup could not be loaded.")
            const saved = googleAdsOnboardingResponse(value.connection)
            setConnection(saved); setCustomerId(saved?.customerId ?? ""); setManager({ id: value.managerId, name: value.managerName }); setReady(true)
        } catch (cause) { if (request.current === controller && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Google Ads setup could not be loaded.") }
        finally { if (request.current === controller) { request.current = null; setLoading(false) } }
    }, [endpoint, relationshipId])
    useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) void load() }); return () => { active = false; request.current?.abort(); request.current = null } }, [load])
    async function submit(action: "request" | "verify") {
        if (writing.current || !ready) return
        writing.current = true; setPending(true); setError(null)
        const controller = new AbortController(); request.current = controller
        let mutationError: string | null = null, denied = false
        try {
            const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(70_000)]), body: JSON.stringify({ relationshipId, customerId, action, consented: action === "request" }) })
            const value = await response.json()
            if (request.current !== controller || controller.signal.aborted) return
            if (response.status === 401 || response.status === 403) { denied = true; setReady(false); setConnection(null); setCustomerId(""); setManager(null) }
            if (!response.ok) throw new Error(value.error || "Google Ads could not be connected. Try again.")
            const saved = googleAdsOnboardingResponse(value.connection)
            if (!saved) throw new Error("The saved connection could not be confirmed. Reload its status.")
            setConnection(saved); setCustomerId(saved.customerId); onSaved()
        } catch (cause) { if (request.current === controller && !controller.signal.aborted) { mutationError = cause instanceof Error ? cause.message : "Google Ads could not be connected."; setError(mutationError); onSaved() } }
        finally { writing.current = false; if (request.current === controller) { request.current = null; setPending(false); if (mutationError && !denied) void load(mutationError) } }
    }
    return <CenteredDialog title="Google Ads connection" busy={pending} onClose={onClose}>
        <p className="mb-4 text-sm text-neutral-300">{clientName}</p>
        {loading ? <p role="status" className="text-sm text-neutral-400">Loading Google Ads setup…</p> : null}
        {connection && ready && !loading && !pending ? <div className="mb-4"><Status label={connection.status === "connected" ? "Connected" : connection.status === "pending" ? "Invitation pending" : "Needs attention"} tone={connection.status === "connected" ? "green" : "yellow"} />{connection.accountName ? <p className="mt-2 text-sm text-neutral-400">{connection.accountName}</p> : null}</div> : null}
        {ready ? <><label className="block text-sm">Customer ID<input value={connection ? formatGoogleAdsCustomerId(customerId) : customerId} onChange={event => setCustomerId(event.target.value)} readOnly={Boolean(connection)} disabled={pending} inputMode="numeric" maxLength={20} placeholder="123-456-7890" className="mt-2 h-11 w-full rounded-xl border border-neutral-700 bg-black px-3 text-white read-only:text-neutral-400" /></label>
            <p className="mt-3 text-sm leading-6 text-neutral-400">Connect this account to {manager?.name || "your agency"}{manager?.id ? ` (${formatGoogleAdsCustomerId(manager.id)})` : ""}. Sending an invitation requests manager access in Google Ads. An account administrator must approve it.</p>
            {connection?.status === "pending" ? <p className="mt-3 text-sm text-neutral-300">After the invitation is approved in Google Ads, check the connection here.</p> : null}
            <div className="mt-5 flex flex-wrap gap-3">{connection?.status !== "connected" ? <button type="button" disabled={pending || !customerId} onClick={() => void submit("request")} className="min-h-11 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">{pending ? "Updating…" : "Send invitation"}</button> : null}<button type="button" disabled={pending || !customerId} onClick={() => void submit("verify")} className="min-h-11 rounded-lg border border-neutral-700 px-4 text-sm disabled:opacity-40">{pending ? "Updating…" : "Check connection"}</button></div>
        </> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-red-200">{error}</p> : null}
        {!loading && !pending ? <button type="button" onClick={() => void load()} className="mt-3 min-h-11 text-sm text-neutral-300 underline underline-offset-4">Reload saved status</button> : null}
    </CenteredDialog>
}
