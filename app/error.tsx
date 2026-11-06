"use client"

import { Button, Card } from "@/components/ui"
import { ErrorBoundaryReporter } from "@/components/errors/ErrorBoundaryReporter"

type AppError = Error & { digest?: string }

export default function ErrorPage({ error, unstable_retry }: { error: AppError; unstable_retry: () => void }) {
    const code = `BGE-${error.digest ?? "UNEXPECTED"}`
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><ErrorBoundaryReporter error={error} boundary="app" /><Card padding="lg" className="w-full max-w-lg"><p className="text-xs font-semibold tracking-[0.18em] text-emerald-300">BETELGEZE</p><h1 className="mt-4 text-3xl font-semibold">We couldn’t load that just now</h1><p className="mt-3 text-sm leading-6 text-neutral-300">Check your connection and try again. Your other workspace tabs can stay open.</p><Button onClick={unstable_retry} className="mt-6">Try again</Button><code className="mt-6 block w-fit max-w-full overflow-auto rounded-lg bg-neutral-950 px-3 py-2 text-sm text-emerald-200">{code}</code></Card></main>
}
