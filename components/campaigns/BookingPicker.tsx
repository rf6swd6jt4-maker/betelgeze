"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { BookingDay } from "@/lib/campaigns/slots"

/** Day and time choice on a public booking page. The server re-checks the time when it is held. */
export function BookingPicker({ slug, submission, reference, days, payLabel }: { slug: string; submission: string | null; reference: string | null; days: BookingDay[]; payLabel: string | null }) {
    const router = useRouter()
    const [day, setDay] = useState(days[0]?.date ?? "")
    const [time, setTime] = useState("")
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const current = days.find(entry => entry.date === day)
    const chosen = current?.slots.find(slot => slot.iso === time)

    async function hold() {
        if (!chosen || pending) return
        setPending(true); setError(null)
        try {
            const response = await fetch(`/api/campaigns/book/${encodeURIComponent(slug)}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ submission, reference, starts_at: chosen.iso }),
            })
            const result = await response.json().catch(() => ({})) as { status?: string; checkout_url?: string; error?: string }
            if (!response.ok) { setError(result.error ?? "Could not hold that time. Please retry."); setPending(false); router.refresh(); return }
            if (result.status === "held" && result.checkout_url) { window.location.assign(result.checkout_url); return }
            router.refresh()
        } catch {
            setError("Could not reach us. Check your connection and try again.")
            setPending(false)
        }
    }

    if (!days.length) return <p className="mt-5 text-sm text-neutral-600">No times are open right now. Please check back soon.</p>
    return <div className="mt-5">
        <div role="group" aria-label="Day" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {days.map(entry => <button key={entry.date} type="button" aria-pressed={entry.date === day} onClick={() => { setDay(entry.date); setTime("") }}
                className={`flex min-w-16 shrink-0 flex-col items-center rounded-xl border px-3 py-2 text-sm ${entry.date === day ? "border-neutral-900 bg-neutral-900 text-white" : "border-black/10 hover:border-black/30"}`}>
                <span className={entry.date === day ? "text-white/70" : "text-neutral-500"}>{entry.weekday}</span><span className="font-medium">{entry.label}</span>
            </button>)}
        </div>
        <div role="group" aria-label="Time" className="mt-4 grid grid-cols-3 gap-2">
            {current?.slots.map(slot => <button key={slot.iso} type="button" aria-pressed={slot.iso === time} onClick={() => setTime(slot.iso)}
                className={`h-11 rounded-xl border text-sm tabular-nums ${slot.iso === time ? "border-neutral-900 bg-neutral-900 text-white" : "border-black/10 hover:border-black/30"}`}>{slot.label}</button>)}
        </div>
        {error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}
        <button type="button" onClick={hold} disabled={!chosen || pending}
            className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-xl bg-neutral-900 px-4 font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300">
            {pending ? "One moment…" : chosen ? payLabel ? `Hold ${current?.weekday} ${current?.label}, ${chosen.label} and pay ${payLabel}` : `Book ${current?.weekday} ${current?.label}, ${chosen.label}` : "Pick a time"}
        </button>
    </div>
}

/** Shown after Stripe sends the visitor back, until the payment confirmation arrives. Checks a few times, then stops. */
export function BookingConfirming({ when }: { when: string }) {
    const router = useRouter()
    const [tries, setTries] = useState(0)
    useEffect(() => {
        if (tries >= 10) return
        const timer = window.setTimeout(() => { setTries(value => value + 1); router.refresh() }, 2_000)
        return () => window.clearTimeout(timer)
    }, [tries, router])
    return <div role="status">
        <p className="font-medium">Payment received. Confirming {when}…</p>
        <p className="mt-2 text-sm text-neutral-600">{tries >= 10 ? "This is taking longer than usual. Your payment is safe; refresh this page in a minute to see your booking." : "This usually takes a few seconds."}</p>
    </div>
}
