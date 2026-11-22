"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import type { BookingDay } from "@/lib/campaigns/slots"
import { BOOKING_FRAME_ORIGINS, BOOKING_HEIGHT_MESSAGE } from "@/lib/campaigns/embed"
import { bookingTheme } from "@/components/campaigns/booking-theme"

/** Day and time choice on a public booking page. The server re-checks the time when it is held. */
export function BookingPicker({ slug, submission, reference, days, payLabel, embed = false }: { slug: string; submission: string | null; reference: string | null; days: BookingDay[]; payLabel: string | null; embed?: boolean }) {
    const router = useRouter()
    const theme = bookingTheme(embed)
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
                body: JSON.stringify({ submission, reference, starts_at: chosen.iso, embed }),
            })
            const result = await response.json().catch(() => ({})) as { status?: string; checkout_url?: string; error?: string }
            if (!response.ok) { setError(result.error ?? "Could not hold that time. Please retry."); setPending(false); router.refresh(); return }
            if (result.status === "held" && result.checkout_url) {
                if (embed && window.top && window.top !== window.self) {
                    // Stripe Checkout cannot run inside a frame: open it in the funnel's window. If the browser refuses
                    // (a sandboxed frame), the held time appears here with its own Pay link, which opens it from a tap.
                    try { window.top.location.assign(result.checkout_url) } catch { /* shown below */ }
                    window.setTimeout(() => { setPending(false); router.refresh() }, 1_500)
                    return
                }
                window.location.assign(result.checkout_url)
                return
            }
            router.refresh()
        } catch {
            setError("Could not reach us. Check your connection and try again.")
            setPending(false)
        }
    }

    if (!days.length) return <p className={`mt-5 text-sm ${theme.muted}`}>No times are open right now. Please check back soon.</p>
    return <div className="mt-5">
        <div role="group" aria-label="Day" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {days.map(entry => <button key={entry.date} type="button" aria-pressed={entry.date === day} onClick={() => { setDay(entry.date); setTime("") }}
                className={`flex min-w-16 shrink-0 flex-col items-center px-3 py-2 text-sm ${entry.date === day ? theme.choiceOn : theme.choice}`}>
                <span className={entry.date === day ? theme.choiceSubOn : theme.choiceSub}>{entry.weekday}</span><span className="font-medium">{entry.label}</span>
            </button>)}
        </div>
        <div role="group" aria-label="Time" className="mt-4 grid grid-cols-3 gap-2">
            {current?.slots.map(slot => <button key={slot.iso} type="button" aria-pressed={slot.iso === time} onClick={() => setTime(slot.iso)}
                className={`h-11 text-sm tabular-nums ${slot.iso === time ? theme.choiceOn : theme.choice}`}>{slot.label}</button>)}
        </div>
        {error ? <p role="alert" className={`mt-4 text-sm ${theme.error}`}>{error}</p> : null}
        <button type="button" onClick={hold} disabled={!chosen || pending}
            className={`mt-5 inline-flex h-12 w-full items-center justify-center px-4 ${theme.primary}`}>
            {pending ? "One moment…" : chosen ? payLabel ? `Hold ${current?.weekday} ${current?.label}, ${chosen.label} and pay ${payLabel}` : `Book ${current?.weekday} ${current?.label}, ${chosen.label}` : "Pick a time"}
        </button>
    </div>
}

/** Shown after Stripe sends the visitor back, until the payment confirmation arrives. Checks a few times, then stops. */
export function BookingConfirming({ when, embed = false }: { when: string; embed?: boolean }) {
    const router = useRouter()
    const [tries, setTries] = useState(0)
    useEffect(() => {
        if (tries >= 10) return
        const timer = window.setTimeout(() => { setTries(value => value + 1); router.refresh() }, 2_000)
        return () => window.clearTimeout(timer)
    }, [tries, router])
    return <div role="status">
        <p className="font-medium">Payment received. Confirming {when}…</p>
        <p className={`mt-2 text-sm ${bookingTheme(embed).muted}`}>{tries >= 10 ? "This is taking longer than usual. Your payment is safe; refresh this page in a minute to see your booking." : "This usually takes a few seconds."}</p>
    </div>
}

/**
 * Embedded in a funnel: tells the parent page this page's height whenever it changes, so its frame can fit it with no
 * scrollbar. Only the height is sent, and only to the sites allowed to frame the page.
 */
export function BookingEmbedHeight({ children }: { children: ReactNode }) {
    const box = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const node = box.current
        if (!node || window.parent === window) return
        let last = 0
        const send = () => {
            const height = Math.ceil(node.getBoundingClientRect().height)
            if (height === last) return
            last = height
            const origin = BOOKING_FRAME_ORIGINS.find(entry => document.referrer.startsWith(`${entry}/`))
            for (const target of origin ? [origin] : BOOKING_FRAME_ORIGINS) window.parent.postMessage({ type: BOOKING_HEIGHT_MESSAGE, height }, target)
        }
        const observer = new ResizeObserver(send)
        observer.observe(node)
        send()
        return () => observer.disconnect()
    }, [])
    return <div ref={box} className="flow-root">{children}</div>
}
