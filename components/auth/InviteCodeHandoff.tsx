"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"

export function InviteCodeHandoff() {
    const router = useRouter()
    const [error, setError] = useState<string | null>(null)
    const [processing, setProcessing] = useState(() =>
        typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).has("code")
            : false
    )

    useEffect(() => {
        const code = new URLSearchParams(window.location.search).get("code")
        if (!code) return
        void (async () => {
            const { error } = await createSupabaseBrowserClient().auth.exchangeCodeForSession(code)
            if (error) { setError("This invitation link is invalid or has expired. Ask for a new invitation."); setProcessing(false); return }
            router.replace("/sign-up?invited=1")
            router.refresh()
        })()
    }, [router])

    if (!error && !processing) return null
    return <p className={`mt-5 text-sm ${error ? "text-red-300" : "text-neutral-300"}`}>{error ?? "Preparing your invitation…"}</p>
}
