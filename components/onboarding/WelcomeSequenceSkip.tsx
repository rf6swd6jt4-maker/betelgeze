"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { skipWelcomeSequence } from "@/app/onboarding/session/[token]/actions"

export function WelcomeSequenceSkip({ token, stepKey }: { token: string; stepKey: string }) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState("")
    return <>
        <button type="button" disabled={pending} onClick={() => startTransition(async () => {
            setError("")
            try {
                const result = await skipWelcomeSequence(token, stepKey)
                router.replace(result.nextPath)
            } catch (error) {
                setError(error instanceof Error ? error.message : "Could not skip welcome")
            }
        })} className="min-h-14 min-w-0 w-full rounded-xl border border-[var(--onboarding-primary)] px-3 py-4 font-medium text-[var(--onboarding-primary)] disabled:opacity-50">
            {pending ? "Skipping…" : "Skip"}
        </button>
        {error ? <p role="alert" className="col-span-full text-sm text-red-700">{error}</p> : null}
    </>
}
