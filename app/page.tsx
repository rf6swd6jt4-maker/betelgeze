import Link from "next/link"

export default function Home() {
    return (
        <main className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-6">
            <div className="max-w-xl text-center">
                <p className="text-sm text-neutral-400">Betelgeze</p>

                <h1 className="mt-4 text-4xl font-semibold tracking-tight">
                    Business automation, made calmer
                </h1>

                <p className="mt-4 text-neutral-300">
                    Create a private dashboard for client onboarding and the
                    operational work around it.
                </p>
                <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                    <Link href="/login" className="rounded-xl bg-white px-5 py-3 font-medium text-black">Log in to your dashboard</Link>
                    <Link href="/sign-up" className="rounded-xl border border-neutral-700 px-5 py-3 font-medium text-white">Create new dashboard</Link>
                </div>
            </div>
        </main>
    )
}
