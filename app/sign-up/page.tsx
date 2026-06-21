"use client"

import Link from "next/link"
import { FormEvent, useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/
const RESEND_COOLDOWN_SECONDS = 60

export default function SignUpPage() {
    const [error, setError] = useState<string | null>(null)
    const [complete, setComplete] = useState(false)
    const [loading, setLoading] = useState(false)
    const [email, setEmail] = useState("")
    const [cooldown, setCooldown] = useState(0)
    const [resent, setResent] = useState(false)

    useEffect(() => {
        if (!complete || cooldown <= 0) return

        const timer = window.setInterval(() => {
            setCooldown((current) => Math.max(0, current - 1))
        }, 1000)

        return () => window.clearInterval(timer)
    }, [complete, cooldown])

    function showConfirmation(emailAddress: string) {
        setEmail(emailAddress)
        setComplete(true)
        setCooldown(RESEND_COOLDOWN_SECONDS)
        setResent(false)
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const values = new FormData(event.currentTarget)
        const slug = String(values.get("workspaceSlug") ?? "")
            .trim()
            .toLowerCase()
        const emailAddress = String(values.get("email") ?? "")
            .trim()
            .toLowerCase()

        if (!slugPattern.test(slug)) {
            setError(
                "Use 3–50 lowercase letters, numbers, or hyphens for the dashboard URL."
            )
            return
        }

        setLoading(true)
        setError(null)
        const supabase = createSupabaseBrowserClient()
        const { error } = await supabase.auth.signUp({
            email: emailAddress,
            password: String(values.get("password") ?? ""),
            options: {
                data: {
                    business_name: String(values.get("businessName") ?? "").trim(),
                    workspace_slug: slug,
                },
                emailRedirectTo: `${window.location.origin}/login`,
            },
        })

        if (error) {
            setError(error.message)
            setLoading(false)
            return
        }

        showConfirmation(emailAddress)
        setLoading(false)
    }

    async function resendConfirmation() {
        if (!email || cooldown > 0) return

        setLoading(true)
        setError(null)
        const supabase = createSupabaseBrowserClient()
        const { error } = await supabase.auth.resend({
            type: "signup",
            email,
            options: {
                emailRedirectTo: `${window.location.origin}/login`,
            },
        })

        if (error) {
            setError(error.message)
            setLoading(false)
            return
        }

        setResent(true)
        setCooldown(RESEND_COOLDOWN_SECONDS)
        setLoading(false)
    }

    if (complete) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white">
                <div className="max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-7">
                    <p className="text-sm text-neutral-400">Betelgeze</p>
                    <h1 className="mt-3 text-2xl font-semibold">
                        Check your email
                    </h1>
                    <p className="mt-3 text-neutral-300">
                        We sent a confirmation link to <strong>{email}</strong>.
                        Confirm it, then log in to set up your authenticator app.
                    </p>
                    {resent && (
                        <p className="mt-4 text-sm text-emerald-300">
                            A fresh confirmation email is on its way.
                        </p>
                    )}
                    {error && (
                        <p className="mt-4 text-sm text-red-400">{error}</p>
                    )}
                    <button
                        type="button"
                        onClick={resendConfirmation}
                        disabled={loading || cooldown > 0}
                        className="mt-6 w-full rounded-lg border border-neutral-600 px-4 py-3 font-medium disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {cooldown > 0
                            ? `Resend available in ${cooldown}s`
                            : loading
                              ? "Sending…"
                              : "Resend confirmation email"}
                    </button>
                    <Link
                        href="/login"
                        className="mt-4 block text-center text-sm text-neutral-300 underline"
                    >
                        Go to login
                    </Link>
                </div>
            </main>
        )
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white">
            <form
                onSubmit={submit}
                className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"
            >
                <p className="text-sm text-neutral-400">Betelgeze</p>
                <h1 className="mt-3 text-2xl font-semibold">
                    Create a new dashboard
                </h1>
                <label className="mt-6 block text-sm">
                    Business name
                    <input name="businessName" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" />
                </label>
                <label className="mt-4 block text-sm">
                    Dashboard URL
                    <input name="workspaceSlug" required placeholder="scaylup" className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" />
                </label>
                <label className="mt-4 block text-sm">
                    Email
                    <input name="email" type="email" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" />
                </label>
                <label className="mt-4 block text-sm">
                    Password
                    <input name="password" type="password" minLength={12} required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" />
                </label>
                {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
                <button disabled={loading} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black disabled:opacity-50">
                    {loading ? "Creating…" : "Create dashboard"}
                </button>
                <p className="mt-5 text-sm text-neutral-400">
                    Already registered? <Link className="text-white underline" href="/login">Log in</Link>
                </p>
            </form>
        </main>
    )
}
