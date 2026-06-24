"use client"

import Link from "next/link"
import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { BrandLockup } from "@/components/brand/BrandLockup"

const usernamePattern = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/
const authOrigin = "https://auth.betelgeze.com"

function SignUpForm() {
    const searchParams = useSearchParams()
    const invite = searchParams.get("invite")
    const [email, setEmail] = useState(searchParams.get("email") ?? "")
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault(); setLoading(true); setError(null)
        const form = new FormData(event.currentTarget); const username = String(form.get("username") ?? "").trim().toLowerCase(); const submittedEmail = String(form.get("email") ?? "").trim().toLowerCase()
        if (!usernamePattern.test(username)) { setError("Use 3–30 lowercase letters, numbers, or hyphens for your username."); setLoading(false); return }
        const confirmationNext = invite ? `/confirmed?invite=${encodeURIComponent(invite)}` : "/confirmed"
        const { error: signUpError } = await createSupabaseBrowserClient().auth.signUp({ email: submittedEmail, password: String(form.get("password") ?? ""), options: { data: { username }, emailRedirectTo: `${authOrigin}/auth/callback?next=${encodeURIComponent(confirmationNext)}` } })
        if (signUpError) { setError(signUpError.message); setLoading(false); return }
        window.location.assign(`${authOrigin}/check-email?email=${encodeURIComponent(submittedEmail)}${invite ? `&invite=${encodeURIComponent(invite)}` : ""}`)
    }
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><BrandLockup compact /><h1 className="mt-5 text-2xl font-semibold">{invite ? "Join your workspace" : "Create your account"}</h1><label className="mt-6 block text-sm">Username<input name="username" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><label className="mt-4 block text-sm">Email<input value={email} onChange={(event) => setEmail(event.target.value)} name="email" type="email" required readOnly={Boolean(invite)} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><label className="mt-4 block text-sm">Password<input name="password" type="password" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label>{error && <p className="mt-4 text-sm text-red-400">{error}</p>}<button disabled={loading} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black">{loading ? "Creating…" : "Create account"}</button><p className="mt-5 text-sm text-neutral-400">Already registered? <Link className="text-white underline" href={`https://auth.betelgeze.com/login${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`}>Log in</Link></p></form></main>
}

export default function SignUpPage() { return <Suspense fallback={null}><SignUpForm /></Suspense> }
