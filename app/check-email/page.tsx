"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { BrandLockup } from "@/components/brand/BrandLockup"

function CheckEmailScreen() {
    const searchParams = useSearchParams()
    const [sending, setSending] = useState(false)
    const [message, setMessage] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const email = searchParams.get("email") ?? ""
    const invite = searchParams.get("invite")
    async function resend() {
        if (!email) return
        setSending(true); setMessage(null); setError(null)
        const response = await fetch("/api/auth/resend-confirmation", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, invite }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) setError(result.error ?? "The confirmation email could not be resent.")
        else setMessage("A fresh confirmation email is on its way.")
        setSending(false)
    }
    async function logOut() { await fetch("/logout", { method: "POST" }); window.location.assign("/login?loggedOut=1") }
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><section className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><BrandLockup compact /><p className="mt-5 text-sm text-neutral-400">Betelgeze security</p><h1 className="mt-3 text-2xl font-semibold">Confirm your email</h1><p className="mt-3 text-neutral-300">We sent a confirmation link{email ? ` to ${email}` : ""}. Confirm it before signing in or joining a workspace.</p>{message && <p className="mt-4 text-sm text-emerald-300">{message}</p>}{error && <p className="mt-4 text-sm text-red-400">{error}</p>}<button type="button" onClick={resend} disabled={sending || !email} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black disabled:opacity-50">{sending ? "Sending…" : "Resend confirmation email"}</button><button type="button" onClick={logOut} className="mt-3 w-full rounded-lg border border-neutral-700 px-4 py-3 font-medium text-white">Log out</button></section></main>
}

export default function CheckEmailPage() { return <Suspense fallback={null}><CheckEmailScreen /></Suspense> }
