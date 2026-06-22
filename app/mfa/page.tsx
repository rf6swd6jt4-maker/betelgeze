"use client"
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"

export default function MfaPage() {
    const router = useRouter()
    const [factorId, setFactorId] = useState<string | null>(null)
    const [qr, setQr] = useState<string | null>(null)
    const [secret, setSecret] = useState<string | null>(null)
    const [code, setCode] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [mode, setMode] = useState<"loading" | "setup" | "verify">("loading")

    useEffect(() => {
        void (async () => {
            const supabase = createSupabaseBrowserClient()
            const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors()
            if (factorsError) { setError(factorsError.message); setMode("verify"); return }
            const existing = factors?.totp.find((factor) => factor.status === "verified")
            if (existing) { setFactorId(existing.id); setMode("verify"); return }
            const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Betelgeze" })
            if (enrollError) { setError(enrollError.message); setMode("setup"); return }
            setFactorId(data.id)
            setQr(data.totp.qr_code)
            setSecret(data.totp.secret)
            setMode("setup")
        })()
    }, [])

    async function verify() {
        if (!factorId) return
        const supabase = createSupabaseBrowserClient()
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
        if (challengeError) { setError(challengeError.message); return }
        const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code })
        if (verifyError) { setError(verifyError.message); return }
        const next = new URLSearchParams(window.location.search).get("next")
        const trustedNext = next && /^https:\/\/(dashboard|onboarding|leadgen)\.betelgeze\.com(?:\/|$)/.test(next)
        if (trustedNext) {
            window.location.assign(next)
            return
        }
        router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard")
        router.refresh()
    }

    async function copySetupKey() {
        if (!secret) return
        await navigator.clipboard.writeText(secret)
        setCopied(true)
    }

    const loading = mode === "loading"
    const verifying = mode === "verify"
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><p className="text-sm text-neutral-400">Betelgeze security</p>{loading ? <div className="mt-3 h-32 animate-pulse rounded-lg bg-neutral-800/60" /> : <><h1 className="mt-3 text-2xl font-semibold">{verifying ? "Confirm your identity" : "Set up two-factor authentication"}</h1><p className="mt-3 text-sm text-neutral-300">{verifying ? "Enter the current six-digit code from your authenticator app." : "Scan this QR code with an authenticator app, then enter its six-digit code."}</p>{qr && <img className="mt-6 h-48 w-48 rounded-lg bg-white p-2" src={qr} alt="Authenticator app QR code" />}{secret && <div className="mt-5 rounded-lg border border-neutral-700 bg-neutral-950 p-4"><p className="text-sm font-medium">QR code not working?</p><p className="mt-1 text-xs text-neutral-400">Choose “Enter setup key” or “manual entry” in your authenticator app. Use a time-based code.</p><code className="mt-3 block break-all rounded bg-neutral-900 p-2 text-xs text-neutral-100">{secret}</code><button type="button" onClick={copySetupKey} className="mt-3 text-sm text-neutral-200 underline">{copied ? "Setup key copied" : "Copy setup key"}</button></div>}<label className="mt-6 block text-sm">Authenticator code<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label>{error && <p className="mt-4 text-sm text-red-400">{error}</p>}<button onClick={verify} disabled={!factorId || code.length !== 6} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black disabled:opacity-50">Verify and continue</button></>}</div></main>
}
