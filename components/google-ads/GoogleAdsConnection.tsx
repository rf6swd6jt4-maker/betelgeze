"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { GoogleAdsLogo } from "@/components/brand/GoogleAdsLogo"
import { Status } from "@/components/ui/Status"
import { formatGoogleAdsCustomerId, googleAdsOnboardingResponse, type GoogleAdsOnboardingConnection } from "@/lib/onboarding/google-ads-state"

export const adsPrimary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--onboarding-primary,#1E3A5F)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
export const adsSecondary = "inline-flex min-h-11 items-center justify-center px-3 py-2 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)] hover:bg-black/5 rounded-lg disabled:opacity-50"
function PencilIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z" /><path d="m13.5 8.5 3 3" /></svg> }
export async function adsFetch(api: string, body?: unknown, signal?: AbortSignal) {
    const response = await fetch(api, { cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(70_000)]) : AbortSignal.timeout(70_000), ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || "The connection could not be loaded. Please retry.")
    return result
}

type Props = {
    api: string | null; active?: boolean; preview?: boolean; locked?: boolean; initialResponse?: unknown; satisfied?: boolean
    onState: (connection: GoogleAdsOnboardingConnection | null, satisfied: boolean, details?: { reportKinds?: string[] }) => void
}
export function GoogleAdsConnection({ api, active = true, preview = false, locked = false, initialResponse, satisfied = false, onState }: Props) {
    const initial = googleAdsOnboardingResponse(initialResponse)
    const [connection, setConnection] = useState(initial), [customerId, setCustomerId] = useState(initial?.customerId ?? "")
    const [manager, setManager] = useState({ id: initial?.managerId ?? (preview ? "9876543210" : ""), name: initial?.managerName ?? "Your agency" })
    const [verified, setVerified] = useState(satisfied), [editing, setEditing] = useState(!initial), [requestFailed, setRequestFailed] = useState(initial?.status === "needs_attention")
    const [loading, setLoading] = useState(!preview && !locked), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null)
    const callbacks = useRef(onState), mounted = useRef(true), read = useRef<AbortController | null>(null), write = useRef(false), version = useRef(0), lastRead = useRef(0)
    useEffect(() => { callbacks.current = onState }, [onState])
    useEffect(() => { const counter = version; mounted.current = true; return () => { mounted.current = false; counter.current++; read.current?.abort(); read.current = null; lastRead.current = 0 } }, [])
    const apply = useCallback((value: GoogleAdsOnboardingConnection | null, ok: boolean, details?: { reportKinds?: string[] }) => {
        setConnection(value); setVerified(ok); callbacks.current(value, ok, details)
        setRequestFailed(value?.status === "needs_attention")
        if (value) { setCustomerId(value.customerId); setManager({ id: value.managerId, name: value.managerName }); setEditing(false) }
        else setEditing(true)
    }, [])
    const load = useCallback(async () => {
        if (!api || preview || locked || read.current || write.current) return
        const controller = new AbortController(), current = version.current
        read.current = controller; lastRead.current = Date.now(); setLoading(true)
        try {
            const value = await adsFetch(api, undefined, controller.signal)
            if (!mounted.current || current !== version.current) return
            if (value.error) throw new Error(value.error)
            setManager({ id: value.managerId, name: value.managerName }); setError(null)
            apply(googleAdsOnboardingResponse(value.connection), value.satisfied === true, { reportKinds: Array.isArray(value.reportKinds) ? value.reportKinds : undefined })
        } catch (e) { if (mounted.current && current === version.current) setError(e instanceof Error && e.name !== "AbortError" ? e.message : "The connection took too long to load. Please retry.") }
        finally { if (read.current === controller) read.current = null; if (mounted.current && current === version.current) setLoading(false) }
    }, [api, preview, locked, apply])
    useEffect(() => {
        const refresh = () => { if (active && document.visibilityState === "visible" && Date.now() - lastRead.current > 60_000) void load() }
        refresh(); window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh)
        return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh) }
    }, [active, load])
    async function connect(action: "request" | "verify") {
        if (write.current || locked || loading) return
        write.current = true; version.current++; read.current?.abort(); read.current = null
        setPending(true); setError(null); setRequestFailed(false)
        try {
            if (preview) {
                apply({ customerId: customerId.replace(/[-\s]/g, "") || "1234567890", managerId: "9876543210", managerName: "Your agency", status: action === "verify" ? "connected" : "pending", accountName: action === "verify" ? "Example advertising account" : null, verifiedAt: action === "verify" ? new Date().toISOString() : null }, action === "verify")
                return
            }
            if (!api) throw new Error("This connection block is unavailable. Reopen this page.")
            const value = await adsFetch(api, { action, customerId, consented: action === "request" ? true : undefined })
            const next = googleAdsOnboardingResponse(value.connection)
            if (!next) throw new Error("The saved connection could not be confirmed. Please reload its status.")
            if (!mounted.current) return
            apply(next, next.status === "connected"); lastRead.current = Date.now()
        } catch (e) {
            if (mounted.current) { setError(e instanceof Error && !["TimeoutError", "AbortError"].includes(e.name) ? e.message : "The invitation could not be checked. Please try again."); setRequestFailed(true); setEditing(false); setVerified(false); callbacks.current(connection, false) }
        } finally { write.current = false; if (mounted.current) setPending(false) }
    }
    function editCustomerId() {
        setEditing(true); setError(null); setRequestFailed(false)
        if (verified) { setVerified(false); callbacks.current(connection, false) }
    }
    const connected = !editing && verified && connection?.status === "connected"
    const awaiting = !editing && !requestFailed && (connection?.status === "pending" || connection?.status === "connected" && !verified)
    const failed = !editing && (requestFailed || connection?.status === "needs_attention")
    const displayCustomerId = editing ? customerId : formatGoogleAdsCustomerId(customerId)
    return <div className="min-w-0" aria-busy={pending}>
        {connected ? <Status surface="light" tone="green" label="Connected" /> : awaiting ? <Status surface="light" tone="yellow" label="Invitation pending" /> : failed ? <Status surface="light" tone="red" label="Invitation failed" /> : null}
        {locked ? <p className="mt-3 text-sm">This step has been submitted.</p> : <form className={`${connected || awaiting || failed ? "mt-4" : ""} space-y-4`} onSubmit={(event) => { event.preventDefault(); void connect(awaiting ? "verify" : "request") }}>
            <label className="block text-sm font-medium">Customer ID<span className="relative mt-2 block"><input value={displayCustomerId} onChange={(event) => setCustomerId(event.target.value)} inputMode="numeric" autoComplete="off" maxLength={20} placeholder="123-456-7890" required readOnly={!editing} disabled={pending} className={`block min-h-12 w-full min-w-0 rounded-xl border border-black/20 px-3 py-2 pr-12 text-base text-[var(--onboarding-text,#0F172A)] focus:outline-[var(--onboarding-primary,#1E3A5F)] ${editing ? "bg-white" : "bg-black/5"}`} />{!editing ? <button data-icon-button type="button" aria-label="Edit customer ID" disabled={pending} onClick={editCustomerId} className="absolute inset-y-1 right-1 inline-flex w-10 items-center justify-center rounded-lg text-[var(--onboarding-muted,#475569)] transition hover:bg-black/5 hover:text-[var(--onboarding-text,#0F172A)] disabled:opacity-50"><PencilIcon /></button> : null}</span></label>
            {!connected ? <button type="submit" disabled={pending || loading || !manager.id} className={adsPrimary}>{pending ? awaiting ? "Checking…" : "Connecting…" : awaiting ? "I have approved the invitation" : <><span>Connect</span><GoogleAdsLogo /></>}</button> : null}
        </form>}
        {error ? <p role="alert" className="mt-3 text-sm leading-6 text-red-700">{error}</p> : null}
        {preview && !locked ? <p className="mt-3 text-xs text-[var(--onboarding-muted,#475569)]">Preview only. No Google account will be contacted.</p> : null}
    </div>
}
