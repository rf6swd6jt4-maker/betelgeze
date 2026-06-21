"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/

export default function SignUpPage() {
    const [error, setError] = useState<string | null>(null)
    const [complete, setComplete] = useState(false)
    const [loading, setLoading] = useState(false)
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const values = new FormData(event.currentTarget)
        const slug = String(values.get("workspaceSlug") ?? "").trim().toLowerCase()
        if (!slugPattern.test(slug)) {
            setError("Use 3–50 lowercase letters, numbers, or hyphens for the dashboard URL.")
            return
        }
        setLoading(true); setError(null)
        const supabase = createSupabaseBrowserClient()
        const { error } = await supabase.auth.signUp({
            email: String(values.get("email") ?? ""),
            password: String(values.get("password") ?? ""),
            options: { data: { business_name: String(values.get("businessName") ?? "").trim(), workspace_slug: slug }, emailRedirectTo: `${window.location.origin}/login` },
        })
        if (error) { setError(error.message); setLoading(false); return }
        setComplete(true); setLoading(false)
    }
    if (complete) return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><div className="max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><p className="text-sm text-neutral-400">Betelgeze</p><h1 className="mt-3 text-2xl font-semibold">Check your email</h1><p className="mt-3 text-neutral-300">Confirm your email address, then log in to set up your authenticator app before opening the dashboard.</p><Link href="/login" className="mt-6 inline-block rounded-lg bg-white px-4 py-3 font-medium text-black">Go to login</Link></div></main>
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><p className="text-sm text-neutral-400">Betelgeze</p><h1 className="mt-3 text-2xl font-semibold">Create a new dashboard</h1><label className="mt-6 block text-sm">Business name<input name="businessName" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><label className="mt-4 block text-sm">Dashboard URL<input name="workspaceSlug" required placeholder="scaylup" className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><label className="mt-4 block text-sm">Email<input name="email" type="email" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><label className="mt-4 block text-sm">Password<input name="password" type="password" minLength={12} required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label>{error && <p className="mt-4 text-sm text-red-400">{error}</p>}<button disabled={loading} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black disabled:opacity-50">{loading ? "Creating…" : "Create dashboard"}</button><p className="mt-5 text-sm text-neutral-400">Already registered? <Link className="text-white underline" href="/login">Log in</Link></p></form></main>
}
