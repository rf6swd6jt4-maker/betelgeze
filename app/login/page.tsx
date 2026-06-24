"use client"

import Link from "next/link"
import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { BrandLockup } from "@/components/brand/BrandLockup"

function LoginForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [identifier, setIdentifier] = useState(searchParams.get("email") ?? "")

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault(); setLoading(true); setError(null)
        const values = new FormData(event.currentTarget)
        const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: String(values.get("identifier") ?? ""), password: String(values.get("password") ?? "") }) })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) {
            if (result.code === "email_unconfirmed") { window.location.assign(`https://auth.betelgeze.com/check-email?email=${encodeURIComponent(result.email ?? String(values.get("identifier") ?? ""))}`); return }
            setError(result.error ?? "Invalid login credentials."); setLoading(false); return
        }
        const invite = searchParams.get("invite"); const next = searchParams.get("next")
        const trustedNext = next && /^https:\/\/(dashboard|onboarding|leadgen)\.betelgeze\.com(?:\/|$)/.test(next)
        const destination = trustedNext ? next : invite ? `/invites/accept?token=${invite}` : "https://dashboard.betelgeze.com/"
        router.replace(`/mfa?next=${encodeURIComponent(destination)}`); router.refresh()
    }

    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><BrandLockup compact /><h1 className="mt-5 text-2xl font-semibold">Log in to your dashboard</h1><label className="mt-6 block text-sm">Username or email<input value={identifier} onChange={(event) => setIdentifier(event.target.value)} name="identifier" autoComplete="username" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><label className="mt-4 block text-sm">Password<input name="password" type="password" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><div className="mt-3 text-right"><Link className="text-sm text-neutral-300 underline" href="/forgot-password">Forgot password?</Link></div>{error && <p className="mt-4 text-sm text-red-400">{error}</p>}<button disabled={loading} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black disabled:opacity-50">{loading ? "Logging in…" : "Log in"}</button><p className="mt-5 text-sm text-neutral-400">New here? <Link className="text-white underline" href="https://betelgeze.com/sign-up">Sign up</Link></p></form></main>
}

export default function LoginPage() { return <Suspense fallback={null}><LoginForm /></Suspense> }
