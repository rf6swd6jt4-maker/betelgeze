"use client"

import { FormEvent, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseRecoveryClient } from "@/lib/supabase/recovery"

export default function UpdatePasswordPage() {
    const router = useRouter()
    const [ready, setReady] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        const supabase = createSupabaseRecoveryClient()

        void (async () => {
            const { data } = await supabase.auth.getSession()
            if (!data.session) {
                setError("This reset link is invalid or has expired. Request a new one.")
            }
            setReady(true)
        })()
    }, [])

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const password = String(new FormData(event.currentTarget).get("password") ?? "")
        setLoading(true)
        setError(null)
        const supabase = createSupabaseRecoveryClient()
        const { error } = await supabase.auth.updateUser({ password })
        if (error) {
            setError(error.message)
            setLoading(false)
            return
        }
        await supabase.auth.signOut()
        router.replace("/login?passwordReset=1")
        router.refresh()
    }

    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><form onSubmit={submit} autoComplete="on" className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><p className="text-sm text-neutral-400">Betelgeze</p><h1 className="mt-3 text-2xl font-semibold">Choose a new password</h1><p className="mt-3 text-sm text-neutral-400">Use at least 12 characters and store it in your password manager.</p><label className="mt-6 block text-sm">New password<input name="password" type="password" autoComplete="new-password" minLength={12} required disabled={!ready || loading} className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3 disabled:opacity-50" /></label>{error && <p className="mt-4 text-sm text-red-400">{error}</p>}<button disabled={!ready || loading} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black disabled:opacity-50">{loading ? "Updating…" : "Update password"}</button></form></main>
}
