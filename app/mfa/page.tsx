"use client"

import { useState } from "react"

const trustedDestination = (value: string | null) => {
    if (value && /^https:\/\/(dashboard|onboarding|leadgen)\.betelgeze\.com(?:\/|$)/.test(value)) return value
    return "https://dashboard.betelgeze.com/"
}

export default function MfaPage() {
    const [code, setCode] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    async function verify(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (submitting) return
        setError(null)
        setSubmitting(true)

        try {
            const response = await fetch("/api/auth/mfa", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
            })
            const body = await response.json() as { error?: string }
            if (!response.ok) {
                setError(body.error ?? "We could not verify that code. Please try again.")
                return
            }
            window.location.assign(trustedDestination(new URLSearchParams(window.location.search).get("next")))
        } catch {
            setError("We could not verify that code. Please check your connection and try again.")
        } finally {
            setSubmitting(false)
        }
    }

    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><p className="text-sm text-neutral-400">Betelgeze security</p><h1 className="mt-3 text-2xl font-semibold">Confirm your identity</h1><p className="mt-3 text-sm text-neutral-300">Enter the current six-digit code from your authenticator app.</p><form onSubmit={verify}><label className="mt-6 block text-sm">Authenticator code<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label>{error && <p className="mt-4 text-sm text-red-400">{error}</p>}<button type="submit" disabled={submitting || code.length !== 6} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black disabled:opacity-50">{submitting ? "Verifying…" : "Verify and continue"}</button></form></div></main>
}
