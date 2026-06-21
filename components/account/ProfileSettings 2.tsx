"use client"

import Link from "next/link"
import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"

type State = { error?: string; username?: string }
type Props = { username: string; email: string; action: (state: State, formData: FormData) => Promise<State> }

export function ProfileSettings({ username, email, action }: Props) {
    const router = useRouter()
    const [state, formAction, pending] = useActionState(action, {})

    useEffect(() => {
        if (state.username && state.username !== username) {
            router.replace(`/users/${state.username}`)
            router.refresh()
        }
    }, [router, state.username, username])

    return <section className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900 p-5"><h2 className="text-xl font-semibold">Profile</h2><p className="mt-1 text-sm text-neutral-400">Your username is used in your Betelgeze account address.</p><form action={formAction} className="mt-5 max-w-md"><label className="block text-sm text-neutral-300">Username<input name="username" defaultValue={username} minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9-]{1,28}[a-z0-9]" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3 text-white" /></label><p className="mt-2 text-xs text-neutral-500">3–30 lowercase letters, numbers, or hyphens. It must be available.</p>{state.error && <p className="mt-3 text-sm text-red-300">{state.error}</p>}{state.username === username && <p className="mt-3 text-sm text-emerald-300">Username saved.</p>}<button disabled={pending} className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save username"}</button></form><div className="mt-7 border-t border-neutral-800 pt-5"><h3 className="font-medium">Password</h3><p className="mt-1 text-sm text-neutral-400">We’ll send a reset link to {email}.</p><Link href={`/forgot-password?email=${encodeURIComponent(email)}`} className="mt-3 inline-block rounded-lg border border-neutral-600 px-4 py-2 text-sm text-neutral-100 hover:border-neutral-400">Reset password</Link></div></section>
}
