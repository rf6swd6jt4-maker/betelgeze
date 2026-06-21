"use client"

import Link from "next/link"
import { FormEvent, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"

const usernamePattern = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/

export default function SignUpPage() {
    const router = useRouter()
    const [invited, setInvited] = useState(false)
    const [ready, setReady] = useState(false)
    const [sent, setSent] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const invite = new URLSearchParams(window.location.search).get("invited") === "1"
        setInvited(invite)
        if (!invite) { setReady(true); return }
        void (async () => { const { data } = await createSupabaseBrowserClient().auth.getUser(); if (!data.user) setError("This invitation link is invalid or has expired. Ask your workspace admin to send a new one."); setReady(true) })()
    }, [])

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setLoading(true); setError(null)
        const values = new FormData(event.currentTarget)
        const username = String(values.get("username") ?? "").trim().toLowerCase()
        const email = String(values.get("email") ?? "").trim().toLowerCase()
        const password = String(values.get("password") ?? "")
        if (!usernamePattern.test(username)) { setError("Use 3–30 lowercase letters, numbers, or hyphens for your username."); setLoading(false); return }
        const supabase = createSupabaseBrowserClient()
        if (invited) {
            const { error: updateError } = await supabase.auth.updateUser({ password, data: { username } })
            if (updateError) { setError(updateError.message); setLoading(false); return }
            const { error: profileError } = await supabase.from("user_profiles").update({ username }).eq("user_id", (await supabase.auth.getUser()).data.user?.id)
            if (profileError) { setError(profileError.code === "23505" ? "That username is already taken." : profileError.message); setLoading(false); return }
            router.replace("/mfa"); router.refresh(); return
        }
        const { error: signUpError } = await supabase.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: `${window.location.origin}/auth/callback?next=/login` } })
        if (signUpError) { setError(signUpError.message); setLoading(false); return }
        setSent(true); setLoading(false)
    }

    if (sent) return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><p className="text-sm text-neutral-400">Betelgeze</p><h1 className="mt-3 text-2xl font-semibold">Check your email</h1><p className="mt-3 text-neutral-300">Confirm your email, then log in and set up two-factor authentication.</p><Link href="/login" className="mt-6 inline-block text-sm underline">Go to login</Link></div></main>
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><p className="text-sm text-neutral-400">Betelgeze</p><h1 className="mt-3 text-2xl font-semibold">{invited ? "Join your workspace" : "Create your account"}</h1><p className="mt-3 text-sm text-neutral-400">{invited ? "Choose your username and password, then set up two-factor authentication." : "Create an account first. You can create a dashboard from your profile."}</p><label className="mt-6 block text-sm">Username<input name="username" required disabled={!ready || loading} placeholder="your-name" className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label>{!invited && <label className="mt-4 block text-sm">Email<input name="email" type="email" required disabled={!ready || loading} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label>}<label className="mt-4 block text-sm">Password<input name="password" type="password" minLength={12} required disabled={!ready || loading} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label>{error && <p className="mt-4 text-sm text-red-400">{error}</p>}<button disabled={!ready || loading || Boolean(error && invited)} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black disabled:opacity-50">{loading ? "Saving…" : invited ? "Continue to security setup" : "Create account"}</button><p className="mt-5 text-sm text-neutral-400">Already registered? <Link className="text-white underline" href="/login">Log in</Link></p></form></main>
}
