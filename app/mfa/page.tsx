"use client"

import { useEffect, useState } from "react"
import { BrandLockup } from "@/components/brand/BrandLockup"

type MfaState = "checking" | "verify" | "start-setup" | "setup"

function destination() {
    const next = new URLSearchParams(window.location.search).get("next")
    if (next && /^https:\/\/(dashboard|onboarding|leadgen)\.betelgeze\.com(?:\/|$)/.test(next)) return next
    if (next?.startsWith("/invites/accept?") && !next.startsWith("//")) return `https://dashboard.betelgeze.com${next}`
    return "https://dashboard.betelgeze.com/"
}

export default function MfaPage() {
    const [state, setState] = useState<MfaState>("checking")
    const [code, setCode] = useState("")
    const [factorId, setFactorId] = useState("")
    const [qr, setQr] = useState("")
    const [secret, setSecret] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        void fetch("/api/auth/mfa")
            .then(async (response) => {
                const body = await response.json() as { verified?: boolean; pendingFactorId?: string | null; error?: string }
                if (!response.ok) throw new Error(body.error ?? "Your session has expired. Please log in again.")
                if (body.pendingFactorId) setFactorId(body.pendingFactorId)
                setState(body.verified || body.pendingFactorId ? "verify" : "start-setup")
            })
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "We could not check your authenticator."))
    }, [])

    async function requestSetup() {
        setError(null)
        setSubmitting(true)
        try {
            const response = await fetch("/api/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setup" }) })
            const body = await response.json() as { factorId?: string; qr?: string; secret?: string; pending?: boolean; error?: string }
            if (!response.ok || !body.factorId) throw new Error(body.error ?? "We could not set up your authenticator.")
            if (body.pending) { setFactorId(body.factorId); setState("verify"); return }
            if (!body.qr || !body.secret) throw new Error("We could not set up your authenticator.")
            setFactorId(body.factorId); setQr(body.qr); setSecret(body.secret); setState("setup")
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "We could not set up your authenticator.")
        } finally { setSubmitting(false) }
    }

    async function recoverSession() {
        setSubmitting(true)
        await fetch("/api/auth/session-recovery", { method: "POST" })
        window.location.reload()
    }

    async function resetSetup() {
        if (submitting) return
        setError(null); setSubmitting(true)
        try {
            const response = await fetch("/api/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset-setup" }) })
            const body = await response.json() as { error?: string }
            if (!response.ok) throw new Error(body.error ?? "We could not clear the unfinished setup.")
            setCode(""); setFactorId(""); setQr(""); setSecret(""); setState("start-setup")
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "We could not clear the unfinished setup.")
        } finally { setSubmitting(false) }
    }

    async function verify(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (submitting) return
        setError(null); setSubmitting(true)
        try {
            const response = await fetch("/api/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, factorId }) })
            const body = await response.json() as { error?: string }
            if (!response.ok) throw new Error(body.error ?? "We could not verify that code. Please try again.")
            window.location.assign(destination())
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "We could not verify that code. Please try again.")
        } finally { setSubmitting(false) }
    }

    const settingUp = state === "setup"
    const checking = state === "checking"
    const hasStaleSession = error?.toLowerCase().includes("invalid refresh token")
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><BrandLockup compact /><p className="mt-5 text-sm text-neutral-400">Security</p><h1 className="mt-3 text-2xl font-semibold">{settingUp || state === "start-setup" ? "Set up two-factor authentication" : "Confirm your identity"}</h1>{checking ? <p className="mt-3 text-sm text-neutral-300">Checking your authenticator…</p> : state === "start-setup" ? <><p className="mt-3 text-sm text-neutral-300">Protect this account with an authenticator app before continuing.</p><button type="button" onClick={requestSetup} disabled={submitting} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black disabled:opacity-50">{submitting ? "Preparing…" : "Set up an authenticator"}</button></> : <><p className="mt-3 text-sm text-neutral-300">{settingUp ? "Scan the QR code with an authenticator app, then enter its current six-digit code." : factorId ? "Enter the six-digit code from the authenticator you already set up to finish securing this account." : "Enter the current six-digit code from your authenticator app."}</p>{settingUp && <><img className="mt-6 h-48 w-48 rounded-lg bg-white p-2" src={qr} alt="Authenticator app QR code" /><p className="mt-4 text-xs text-neutral-400">Manual setup key</p><code className="mt-1 block break-all rounded bg-neutral-950 p-2 text-xs text-neutral-100">{secret}</code></>}<form onSubmit={verify}><label className="mt-6 block text-sm">Authenticator code<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><button type="submit" disabled={submitting || code.length !== 6} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black disabled:opacity-50">{submitting ? "Verifying…" : "Verify and continue"}</button></form>{factorId && <button type="button" onClick={resetSetup} disabled={submitting} className="mt-4 w-full text-sm text-neutral-300 underline disabled:opacity-50">Set up a different authenticator</button>}<p className="mt-3 text-xs leading-5 text-neutral-500">This only clears an unfinished setup. A verified authenticator cannot be removed here.</p></>}{error && <p className="mt-4 text-sm text-red-400">{hasStaleSession ? "An old browser session is conflicting with your new sign-in." : error}</p>}{hasStaleSession && <button type="button" onClick={recoverSession} disabled={submitting} className="mt-4 text-sm text-neutral-200 underline disabled:opacity-50">Clear the old session and try again</button>}</div></main>
}
