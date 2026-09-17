"use client"

import { useActionState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { AuthFieldFeedback } from "@/components/auth/AuthFieldFeedback"

type State = { error?: string; username?: string; displayName?: string }
type Props = { username: string; displayName: string; action: (state: State, formData: FormData) => Promise<State> }

export function ProfileSettings({ username, displayName, action }: Props) {
    const router = useRouter()
    const [state, formAction, pending] = useActionState(action, {})

    useEffect(() => {
        if (state.username && state.username !== username) { router.replace(`/users/${state.username}`); router.refresh() }
        else if (state.displayName && state.displayName !== displayName) router.refresh()
    }, [displayName, router, state.displayName, state.username, username])

    return <section className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900 p-5"><h2 className="text-xl font-semibold">Profile</h2><p className="mt-1 text-sm text-neutral-400">Your display name identifies you in client chats. It does not need to be unique.</p><form action={formAction} className="mt-5 max-w-md"><label className="block text-sm text-neutral-300">Display name<input name="displayName" defaultValue={displayName} minLength={1} maxLength={50} required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3 text-white" /></label><p className="mt-2 text-xs text-neutral-500">Shown to clients as ~ {displayName || "Your name"}.</p><label className="mt-5 block text-sm text-neutral-300">Username<input name="username" defaultValue={username} minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9-]{1,28}[a-z0-9]" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3 text-white" /></label><p className="mt-2 text-xs text-neutral-500">Used in your Betelgeze account address and must be unique.</p>{state.error ? <AuthFieldFeedback tone="red" message={state.error} /> : null}{state.username === username && state.displayName === displayName ? <AuthFieldFeedback tone="green" message="Profile saved." /> : null}<button disabled={pending} className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save profile"}</button></form></section>
}
