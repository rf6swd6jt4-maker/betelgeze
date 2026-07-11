"use client"

import { useEffect } from "react"

type AppError = Error & { digest?: string }

export default function ErrorPage({ error }: { error: AppError; reset: () => void }) {
    useEffect(() => { console.error(error) }, [error])
    const code = `BGE-${error.digest ?? "UNEXPECTED"}`
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><section className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-8"><p className="text-xs font-semibold tracking-[0.18em] text-emerald-300">BETELGEZE</p><h1 className="mt-4 text-3xl font-semibold">An error has occurred</h1><p className="mt-3 text-sm leading-6 text-neutral-300">Close the web app, then open it again and log back in. If the issue persists, report the code below to Betelgeze support.</p><code className="mt-6 block w-fit max-w-full overflow-auto rounded-lg bg-neutral-950 px-3 py-2 text-sm text-emerald-200">{code}</code></section></main>
}
