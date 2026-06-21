"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { FormEvent, useState } from "react"

export default function LoginPage() {
    const router = useRouter()
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setLoading(true)
        setError(null)
        const values = new FormData(event.currentTarget)
        const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ identifier: String(values.get("identifier") ?? ""), password: String(values.get("password") ?? "") }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) {
            setError(result.error ?? "Invalid login credentials.")
            setLoading(false)
            return
        }
        router.replace("/dashboard")
        router.refresh()
    }

    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><p className="text-sm text-neutral-400">Betelgeze</p><h1 className="mt-3 text-2xl font-semibold">Log in to your dashboard</h1><label className="mt-6 block text-sm">Username or email<input name="identifier" autoComplete="username" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><label className="mt-4 block text-sm">Password<input name="password" type="password" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><div className="mt-3 text-right"><Link className="text-sm text-neutral-300 underline" href="/forgot-password">Forgot password?</Link></div>{error && <p className="mt-4 text-sm text-red-400">{error}</p>}<button disabled={loading} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black disabled:opacity-50">{loading ? "Logging in…" : "Log in"}</button><p className="mt-5 text-sm text-neutral-400">New here? <Link className="text-white underline" href="/sign-up">Create a dashboard</Link></p></form></main>
}
