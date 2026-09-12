"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { GoogleAdsLogo } from "@/components/brand/GoogleAdsLogo"
import { Status } from "@/components/ui/Status"
import { formatGoogleAdsCustomerId, googleAdsOnboardingResponse, type GoogleAdsOnboardingConnection } from "@/lib/onboarding/google-ads-state"

export const adsPrimary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--onboarding-primary,#1E3A5F)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
export const adsSecondary = "inline-flex min-h-11 items-center justify-center px-3 py-2 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)] hover:bg-black/5 rounded-lg disabled:opacity-50"
export async function adsFetch(api: string, body?: unknown, signal?: AbortSignal) {
    const response = await fetch(api, { cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(70_000)]) : AbortSignal.timeout(70_000), ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || "The connection could not be loaded. Please retry.")
    return result
}

type Props = {
    api: string | null; active?: boolean; preview?: boolean; locked?: boolean; initialResponse?: unknown; satisfied?: boolean
    onState: (connection: GoogleAdsOnboardingConnection | null, satisfied: boolean) => void
}
export function GoogleAdsConnection({ api, active = true, preview = false, locked = false, initialResponse, satisfied = false, onState }: Props) {
    const [manual, setManual] = useState(false)
    const [oauthAvailable, setOauthAvailable] = useState(false), [oauthWaiting, setOauthWaiting] = useState(false)
    const popup = useRef<Window | null>(null)
    const initial = googleAdsOnboardingResponse(initialResponse)
    const [connection, setConnection] = useState(initial), [customerId, setCustomerId] = useState(initial?.customerId ?? "")
    const [manager, setManager] = useState({ id: initial?.managerId ?? (preview ? "9876543210" : ""), name: initial?.managerName ?? "Your agency" })
    const [verified, setVerified] = useState(satisfied), [expanded, setExpanded] = useState(Boolean(initial)), [consented, setConsented] = useState(false)
    const [loading, setLoading] = useState(!preview && !locked), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null)
    const callbacks = useRef(onState), mounted = useRef(true), read = useRef<AbortController | null>(null), write = useRef(false), version = useRef(0), lastRead = useRef(0)
    useEffect(() => { callbacks.current = onState }, [onState])
    useEffect(() => { const counter = version; mounted.current = true; return () => { mounted.current = false; counter.current++; read.current?.abort(); read.current = null; lastRead.current = 0 } }, [])
    const apply = useCallback((value: GoogleAdsOnboardingConnection | null, ok: boolean) => {
        setConnection(value); setVerified(ok); callbacks.current(value, ok)
        if (value) { setCustomerId(value.customerId); setManager({ id: value.managerId, name: value.managerName }); setExpanded(true) }
    }, [])
    const load = useCallback(async () => {
        if (!api || preview || locked || read.current || write.current) return
        const controller = new AbortController(), current = version.current
        read.current = controller; lastRead.current = Date.now(); setLoading(true)
        try {
            const value = await adsFetch(api, undefined, controller.signal)
            if (!mounted.current || current !== version.current) return
            if (value.error) throw new Error(value.error)
            setManager({ id: value.managerId, name: value.managerName }); setOauthAvailable(value.oauthEnabled === true); setError(null)
            apply(googleAdsOnboardingResponse(value.connection), value.satisfied === true)
        } catch (e) { if (mounted.current && current === version.current) setError(e instanceof Error && e.name !== "AbortError" ? e.message : "The connection took too long to load. Please retry.") }
        finally { if (read.current === controller) read.current = null; if (mounted.current && current === version.current) setLoading(false) }
    }, [api, preview, locked, apply])
    useEffect(() => {
        const refresh = () => { if (active && document.visibilityState === "visible" && Date.now() - lastRead.current > 60_000) void load() }
        refresh(); window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh)
        return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh) }
    }, [active, load])
    useEffect(() => {
        const completed = (event: MessageEvent) => {
            if (event.origin !== "https://app.betelgeze.com" || event.source !== popup.current || event.data?.type !== "betelgeze-google-ads") return
            setOauthWaiting(false); void load()
        }
        window.addEventListener("message", completed)
        return () => window.removeEventListener("message", completed)
    }, [load])
    async function signIn() {
        if (!api || pending || loading || locked || write.current) return
        const opened = window.open("about:blank", "_blank", "popup,width=560,height=740")
        if (!opened) { setError("Allow this page to open Google sign-in, then try again."); return }
        popup.current = opened; write.current = true; version.current++; read.current?.abort(); read.current = null; setPending(true); setError(null)
        try {
            const result = await adsFetch(api, { action: "oauth_start" })
            if (typeof result.url !== "string" || !result.url.startsWith("https://app.betelgeze.com/api/google-ads/oauth/start?state=")) throw new Error("Google sign-in could not be started.")
            opened.location.href = result.url; setOauthWaiting(true)
        } catch (e) { opened.close(); setError(e instanceof Error ? e.message : "Google sign-in could not be started.") }
        finally { write.current = false; if (mounted.current) setPending(false) }
    }
    async function connect(action: "request" | "verify") {
        if (write.current || locked || loading) return
        write.current = true; version.current++; read.current?.abort(); read.current = null
        setPending(true); setError(null); setNotice(null)
        try {
            if (preview) {
                apply({ customerId: customerId.replace(/[-\s]/g, "") || "1234567890", managerId: "9876543210", managerName: "Your agency", status: action === "verify" ? "connected" : "pending", accountName: action === "verify" ? "Example advertising account" : null, verifiedAt: action === "verify" ? new Date().toISOString() : null }, action === "verify")
                return
            }
            if (!api) throw new Error("This connection block is unavailable. Reopen this page.")
            const value = await adsFetch(api, { action, customerId, consented: action === "request" ? consented || connection?.status === "pending" : undefined })
            const next = googleAdsOnboardingResponse(value.connection)
            if (!next) throw new Error("The saved connection could not be confirmed. Please reload its status.")
            if (!mounted.current) return
            apply(next, next.status === "connected"); lastRead.current = Date.now()
            if (next.status === "pending") setNotice(action === "verify" ? "Approval is still pending. If you just accepted, give Google a moment and check again." : "Your access request is ready to approve in Google Ads.")
        } catch (e) {
            if (mounted.current) { setError(e instanceof Error && !["TimeoutError", "AbortError"].includes(e.name) ? e.message : "The request did not finish here. Reload status to check whether it completed before retrying."); setVerified(false); callbacks.current(connection, false) }
        } finally { write.current = false; if (mounted.current) setPending(false) }
    }
    const connected = verified && connection?.status === "connected", awaiting = connection?.status === "pending" || connection?.status === "connected" && !verified
    return <div className="min-w-0" aria-busy={pending}>
        <Status surface="light" tone={connected ? "green" : awaiting ? "yellow" : "grey"} label={connected ? "Connected" : awaiting ? "Awaiting approval" : loading ? "Checking connection…" : "Not connected"} />
        {connected ? <div className="mt-3 flex items-center gap-3"><GoogleAdsLogo className="h-7 w-7 shrink-0" /><div className="min-w-0"><p className="break-words text-sm font-medium">{connection.accountName || "Google Ads account"}</p><p className="text-xs text-[var(--onboarding-muted,#475569)]">{formatGoogleAdsCustomerId(connection.customerId)}</p></div></div> : locked ? <p className="mt-3 text-sm">This step has been submitted.</p> : !expanded ? <><p className="mt-3 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Connect your advertising account to share access with your agency and see your results.</p><button type="button" className={`${adsPrimary} mt-4`} onClick={() => setExpanded(true)}><GoogleAdsLogo />Connect Google Ads</button></> : <div className="mt-4 space-y-4">
            {oauthAvailable && !preview ? <div className="space-y-2"><button type="button" className={adsPrimary} disabled={pending || loading} onClick={() => void signIn()}>{pending ? "Please wait…" : "Sign in with Google"}</button><p className="text-xs leading-5 text-[var(--onboarding-muted,#475569)]">Choose your advertising account and approve agency access.</p>{oauthWaiting ? <button type="button" className={adsSecondary} onClick={() => void load()}>Finished in Google? Reload status</button> : null}</div> : null}
            {awaiting ? <>
                <p className="text-sm leading-6">Approve <strong>{manager.name}</strong>{manager.id ? <> ({formatGoogleAdsCustomerId(manager.id)})</> : null} for account <strong>{formatGoogleAdsCustomerId(connection.customerId)}</strong>.</p>
                <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-[var(--onboarding-muted,#475569)]"><li>Open that account in Google Ads.</li><li>Go to <strong>Admin → Access and security → Managers</strong>.</li><li>Accept the request from {manager.name}. You need administrator access to approve it.</li><li>Return here and check the connection.</li></ol>
                <div className="flex flex-wrap gap-2"><a className={adsSecondary} href="https://ads.google.com/aw/accountaccess" target="_blank" rel="noopener noreferrer">Open Google Ads ↗</a><button type="button" disabled={pending || loading} className={adsPrimary} onClick={() => void connect("verify")}>{pending ? "Checking…" : "Check connection"}</button></div>
                <button type="button" className={adsSecondary} disabled={pending || loading} onClick={() => void connect("request")}>No invitation showing? Retry request</button>
            </> : <>{oauthAvailable && !manual ? <button type="button" className={adsSecondary} onClick={() => setManual(true)}>Use customer ID instead</button> : null}{!oauthAvailable || manual ? <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void connect("request") }}>
                <label className="block text-sm font-medium">Google Ads customer ID<input value={customerId} onChange={(e) => setCustomerId(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={20} placeholder="123-456-7890" required disabled={pending} className="mt-2 block min-h-12 w-full min-w-0 rounded-xl border border-black/20 bg-white px-3 py-2 text-base text-[var(--onboarding-text,#0F172A)] focus:outline-[var(--onboarding-primary,#1E3A5F)]" /></label>
                <p className="text-xs leading-5 text-[var(--onboarding-muted,#475569)]">Find the 10-digit ID at the top of Google Ads. Use the individual account that runs your ads.</p>
                <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} required disabled={pending} className="mt-1 h-4 w-4 shrink-0 accent-[var(--onboarding-primary,#1E3A5F)]" /><span>I am authorised to connect this account to {manager.name} for campaign management and reporting.</span></label>
                <p className="text-sm leading-6 text-[var(--onboarding-muted,#475569)]">We’ll request access for you to approve in Google Ads. If your agency already has access, we’ll verify it now.</p>
                <button type="submit" disabled={pending || loading || !consented || !manager.id} className={adsPrimary}>{pending ? "Connecting…" : "Connect account"}</button>
                {connection?.status === "needs_attention" ? <button type="button" className={adsSecondary} disabled={pending || loading} onClick={() => void connect("verify")}>Already approved? Check connection</button> : null}
            </form> : null}</>}
        </div>}
        {notice ? <p role="status" className="mt-3 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">{notice}</p> : null}
        {error ? <div role="alert" className="mt-4 text-sm leading-6 text-red-700"><p>{error}</p><button type="button" className={adsSecondary} disabled={pending || loading} onClick={() => void load()}>Reload status</button></div> : null}
        {preview && expanded ? <p className="mt-3 text-xs text-[var(--onboarding-muted,#475569)]">Preview only. No Google account will be contacted.</p> : null}
    </div>
}
