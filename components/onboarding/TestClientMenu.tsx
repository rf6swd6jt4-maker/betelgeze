import Link from "next/link"

type TestClientMenuProps = {
    currentStepTitle: string
    previousStepHref?: string | null
    skipAction: () => Promise<void>
}

export function TestClientMenu({
    currentStepTitle,
    previousStepHref,
    skipAction,
}: TestClientMenuProps) {
    return (
        <details className="relative">
            <summary className="flex h-10 cursor-pointer list-none items-center rounded-full border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-950 transition hover:border-amber-400">
                Test menu
            </summary>

            <div className="absolute right-0 top-12 z-40 w-72 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xl">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                    Test client
                </p>

                <p className="mt-2 text-sm text-slate-600">
                    Current step:{" "}
                    <span className="font-semibold text-slate-950">
                        {currentStepTitle}
                    </span>
                </p>

                <form action={skipAction} className="mt-4">
                    <button className="w-full rounded-lg bg-[#1E3A5F] px-3 py-2 text-sm font-semibold text-white">
                        Skip this step
                    </button>
                </form>

                {previousStepHref ? (
                    <Link
                        href={previousStepHref}
                        className="mt-3 block rounded-lg border border-slate-200 px-3 py-2 text-center text-sm font-semibold text-slate-700"
                    >
                        Previous step
                    </Link>
                ) : (
                    <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-center text-sm text-slate-400">
                        No previous step
                    </p>
                )}
            </div>
        </details>
    )
}
