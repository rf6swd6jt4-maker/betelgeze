"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"

export default function ForgotPasswordPage() {
    const [sent, setSent] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setLoading(true)
        setError(null)
        const email = String(new FormData(event.currentTarget).get("email") ?? "")
            .trim()
            .toLowerCase()
        const supabase = createSupabaseBrowserClient()
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/update-password`,
        })
        if (error) {
            setError(error.message)
            setLoading(false)
            return
        }
        setSent(true)
        setLoading(false)
    }

    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7">{sent ? <><p className="text-sm text-neutral-400">Betelgeze</p><h1 className="mt-3 text-2xl font-semibold">Check your email</h1><p className="mt-3 text-neutral-300">If that account exists, we’ve sent a password-reset link.</p><Link href="/login" className="mt-6 inline-block text-sm text-neutral-300 underline">Back to login</Link></> : <form onSubmit={submit}><p className="text-sm text-neutral-400">Betelgeze</p><h1 className="mt-3 text-2xl font-semibold">Reset your password</h1><p className="mt-3 text-sm text-neutral-400">Enter the email address for your dashboard account.</p><label className="mt-6 block text-sm">Email<input name="email" type="email" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label>{error && <p className="mt-4 text-sm text-red-400">{error}</p>}<button disabled={loading} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black disabled:opacity-50">{loading ? "Sending…" : "Send reset link"}</button><Link href="/login" className="mt-5 block text-sm text-neutral-300 underline">Back to login</Link></form>}</div></main>
}
