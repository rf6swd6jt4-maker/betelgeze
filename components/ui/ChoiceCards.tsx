import type { ReactNode } from "react"

/** A small visual choice gallery, before a record-specific setup flow. */
export function ChoiceCards({ label, children }: { label: string; children: ReactNode }) {
    return <div role="group" aria-label={label} className="grid grid-cols-1 gap-3 sm:grid-cols-3">{children}</div>
}
export function ChoiceCard({ label, description, thumbnail, onClick }: { label: string; description: string; thumbnail: ReactNode; onClick: () => void }) {
    return <button type="button" onClick={onClick} className="flex min-w-0 items-center gap-4 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-left transition hover:border-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:flex-col sm:text-center">
        <span aria-hidden="true" className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-950 sm:h-24 sm:w-full">{thumbnail}</span>
        <span className="min-w-0"><span className="block text-sm font-semibold text-white">{label}</span><span className="mt-1 block text-xs leading-5 text-neutral-400">{description}</span></span>
    </button>
}
