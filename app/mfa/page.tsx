"use client"
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"

export default function MfaPage() {
    const router = useRouter(); const [factorId, setFactorId] = useState<string | null>(null); const [qr, setQr] = useState<string | null>(null); const [code, setCode] = useState(""); const [error, setError] = useState<string | null>(null)
    useEffect(() => { void (async () => { const supabase = createSupabaseBrowserClient(); const { data: factors } = await supabase.auth.mfa.listFactors(); const existing = factors?.totp.find((factor) => factor.status === "verified"); if (existing) { setFactorId(existing.id); return } const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Betelgeze" }); if (error) setError(error.message); else { setFactorId(data.id); setQr(data.totp.qr_code) } })() }, [])
    async function verify() { if (!factorId) return; const supabase = createSupabaseBrowserClient(); const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId }); if (challengeError) { setError(challengeError.message); return } const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code }); if (error) { setError(error.message); return } router.replace("/dashboard"); router.refresh() }
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><p className="text-sm text-neutral-400">Betelgeze security</p><h1 className="mt-3 text-2xl font-semibold">Set up two-factor authentication</h1><p className="mt-3 text-sm text-neutral-300">Scan this QR code with an authenticator app, then enter its six-digit code.</p>{qr && <img className="mt-6 h-48 w-48 rounded-lg bg-white p-2" src={qr} alt="Authenticator app QR code" />}<label className="mt-6 block text-sm">Authenticator code<input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label>{error && <p className="mt-4 text-sm text-red-400">{error}</p>}<button onClick={verify} disabled={!factorId || !code} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black disabled:opacity-50">Verify and continue</button></div></main>
}
