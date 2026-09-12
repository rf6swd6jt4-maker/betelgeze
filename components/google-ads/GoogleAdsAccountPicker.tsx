"use client"
import { useEffect, useState } from "react"
import { Selector } from "@/components/ui/Selector"
import { GoogleAdsLogo } from "@/components/brand/GoogleAdsLogo"
import { adsFetch, adsPrimary, adsSecondary } from "./GoogleAdsConnection"
import { formatGoogleAdsCustomerId } from "@/lib/onboarding/google-ads-state"
type View = { phase: string; choices: { id: string; name: string }[]; limited: boolean; managerName: string; status: string | null; origin: string }
export function GoogleAdsAccountPicker({ state }: { state: string }) {
    const api = `/api/google-ads/oauth/session?state=${encodeURIComponent(state)}`
    const [view, setView] = useState<View | null>(null), [selected, setSelected] = useState(""), [consented, setConsented] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("")
    useEffect(() => {
        const controller = new AbortController()
        adsFetch(api, undefined, controller.signal).then(setView).catch(() => { if (!controller.signal.aborted) setError("This Google sign-in is unavailable. Close this window and start again from your portal or onboarding.") })
        return () => controller.abort()
    }, [api])
    const done = view?.phase === "done"
    useEffect(() => { if (done && view?.origin) window.opener?.postMessage({ type: "betelgeze-google-ads" }, view.origin) }, [done, view?.origin])
    async function connect() {
        if (!selected || !consented || pending) return
        setPending(true); setError("")
        try { const result = await adsFetch(api, { customerId: selected, consented }); setView(current => current ? { ...current, phase: "done", status: result.status, origin: result.origin } : null) }
        catch (e) { setError(e instanceof Error ? e.message : "The account could not be connected.") }
        finally { setPending(false) }
    }
    return <main className="min-h-dvh bg-[#F8F7F4] px-4 py-10 text-[#0F172A]"><section className="mx-auto max-w-lg rounded-2xl border border-black/10 bg-white p-6 shadow-sm" aria-busy={pending}>
        <div className="flex items-center gap-3"><GoogleAdsLogo className="h-8 w-8" /><h1 className="text-xl font-semibold">Connect Google Ads</h1></div>
        {!view && !error ? <p className="mt-5 text-sm" role="status">Loading your accounts…</p> : done ? <div className="mt-5 space-y-4"><p className="text-sm leading-6">{view.status === "connected" ? "Your Google Ads account is connected. Return to your portal or onboarding to see its status." : "Your agency’s access request is ready. Return to your portal or onboarding for the remaining Google Ads approval steps."}</p><button className={adsPrimary} onClick={() => window.close()}>Close this window</button><p className="text-xs text-slate-600">If this window stays open, switch back to your original tab and reload the connection status.</p></div> : view?.phase === "ready" ? <form className="mt-5 space-y-5" onSubmit={e => { e.preventDefault(); void connect() }}>
            <p className="text-sm leading-6">Choose the account that runs your ads. We’ll connect it to {view.managerName} for campaign management and reporting.</p>
            {view.choices.length ? <Selector surface="light" appearance="input" ariaLabel="Advertising account" value={selected} options={view.choices.map(choice => ({ value: choice.id, label: choice.name, description: formatGoogleAdsCustomerId(choice.id) }))} onChange={value => { setSelected(value); setConsented(false) }} disabled={pending} /> : <p className="text-sm">No active advertising accounts were available. Close this window and sign in with an account that has Google Ads access, or use your customer ID.</p>}
            {view.limited ? <p className="text-xs leading-5 text-slate-600">Some accounts could not be listed. If yours is missing, return and use its customer ID to connect.</p> : null}
            {selected ? <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={consented} onChange={e => setConsented(e.target.checked)} disabled={pending} className="mt-1 h-4 w-4 shrink-0" /><span>I am authorised to grant {view.managerName} manager access to account {formatGoogleAdsCustomerId(selected)} for campaign management and reporting.</span></label> : null}
            <button className={adsPrimary} disabled={!selected || !consented || pending}>{pending ? "Connecting…" : "Approve and connect"}</button>
        </form> : view ? <p className="mt-5 text-sm leading-6">This sign-in could not be completed. Return to your portal or onboarding and reload the connection status before trying again.</p> : null}
        {error ? <div role="alert" className="mt-5 text-sm leading-6 text-red-700">{error}<button className={`${adsSecondary} mt-2 block`} onClick={() => window.close()}>Close this window</button></div> : null}
    </section></main>
}
