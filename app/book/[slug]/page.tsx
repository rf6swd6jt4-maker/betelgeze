import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Instrument_Serif, Manrope } from "next/font/google"
import { bookingParams, loadBookingLogo, loadBookingPage } from "@/lib/campaigns/booking"
import { ClientBrandLogo } from "@/components/client-branding/ClientBrandLogo"
import { bookingDays } from "@/lib/campaigns/slots"
import { formatAppointment, formatMoney, meetingPlaceLabels, timeZoneLabels } from "@/lib/campaigns/model"
import { BookingPicker, BookingConfirming, BookingEmbedHeight } from "@/components/campaigns/BookingPicker"
import { bookingTheme } from "@/components/campaigns/booking-theme"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Book a time", robots: { index: false, follow: false } }

// The funnel's fonts, for the embedded look only (not preloaded, so the standalone page never fetches them).
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", preload: false })
const instrument = Instrument_Serif({ subsets: ["latin"], weight: "400", display: "swap", preload: false })

/**
 * A source's public booking page (docs/campaign-booking.md). Agency-branded; no Betelgeze branding. With `embed=1` it
 * is the funnel's booking panel: no logo, title or page background, the funnel's look, Stripe in the funnel's window,
 * and its height posted to the funnel.
 */
export default async function BookingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const [{ slug }, query] = await Promise.all([params, searchParams])
    const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value
    const { submission, reference } = bookingParams({ submission: first(query.submission), ref: first(query.ref) })
    const embed = first(query.embed) === "1"
    const theme = bookingTheme(embed)
    const page = await loadBookingPage(slug, submission, reference)
    if (!page) notFound()
    const logoSrc = embed ? null : await loadBookingLogo(page.source_id).catch(() => null)
    const zone = timeZoneLabels[page.time_zone as keyof typeof timeZoneLabels] ?? page.time_zone
    const needsPayment = page.pay_amount_cents !== null && !page.lead?.paid_credit
    const open = page.open
    const held = open?.status === "held" && open.checkout_url ? open : null
    // The held time is not offered again: it is already theirs until it lapses.
    const days = page.lead && !(open?.status === "booked") ? bookingDays(page, new Date(), held ? [...page.taken, held.starts_at] : page.taken) : []
    const heldUntil = held ? new Intl.DateTimeFormat("en-US", { timeZone: page.time_zone, hour: "numeric", minute: "2-digit" }).format(new Date(held.held_until ?? held.starts_at)) : ""
    const display = `${theme.display} ${embed ? instrument.className : ""}`
    const picker = <BookingPicker slug={slug} submission={submission} reference={reference} days={days} payLabel={needsPayment ? formatMoney(page.pay_amount_cents) : null} embed={embed} />

    const body = <main className={`${theme.main} ${embed ? manrope.className : ""}`}>
        <div className="mx-auto w-full max-w-xl">
            {embed ? null : <>
                <ClientBrandLogo logoSrc={logoSrc} workspaceName={page.workspace_name} className="h-8 max-w-full" fallbackClassName="block max-w-full truncate text-sm font-semibold text-neutral-700" />
                <h1 className="mt-6 text-2xl font-semibold tracking-tight text-balance">{page.meeting_title}</h1>
                <p className="mt-1 text-sm text-neutral-600">{page.meeting_minutes} minutes · {meetingPlaceLabels[page.meeting_place].split(",")[0]} · {zone} time</p>
            </>}

            <div className={theme.card}>
                {!page.lead ? <>
                    <p className="font-medium">Open this page from the form</p>
                    <p className={`mt-2 text-sm ${theme.muted}`}>This booking page works with the form you filled in, so we know who the time is for. Go back to the form and submit it, and it brings you here.</p>
                </> : open?.status === "booked" ? <>
                    <p className={`text-sm ${theme.muted}`}>{`You're booked, ${page.lead.first_name}`}</p>
                    <p className={`mt-1 ${display}`}>{formatAppointment(open.starts_at, page.time_zone)}</p>
                    <p className={`mt-3 text-sm ${theme.muted}`}>{page.meeting_place === "phone" ? "We'll call you at that time on the number you gave us." : `We'll send the ${meetingPlaceLabels[page.meeting_place]} link before the call.`}</p>
                </> : open?.status === "held" && first(query.paid) === "1" ? <BookingConfirming when={formatAppointment(open.starts_at, page.time_zone)} embed={embed} />
                : held ? <>
                    <p className={`text-sm ${theme.muted}`}>{`Your time is held, ${page.lead.first_name}`}</p>
                    <p className={`mt-1 ${display}`}>{formatAppointment(held.starts_at, page.time_zone)}</p>
                    <p className={`mt-2 text-sm ${theme.muted}`}>{`It's yours until ${heldUntil}. Pay ${formatMoney(page.pay_amount_cents)} to confirm it.${page.refund_rule ? ` ${page.refund_rule}` : ""}`}</p>
                    {/* Embedded, Stripe opens in the funnel's window: Checkout cannot run inside a frame. */}
                    <a href={held.checkout_url!} target={embed ? "_top" : undefined} className={`mt-5 inline-flex h-12 w-full items-center justify-center px-4 ${theme.primary}`}>Pay {formatMoney(page.pay_amount_cents)} to confirm</a>
                    <details className={`group mt-5 border-t pt-4 ${theme.rule}`}>
                        <summary className={`cursor-pointer list-none text-sm font-medium ${theme.link} [&::-webkit-details-marker]:hidden`}>Pick a different time <span aria-hidden="true" className="inline-block transition group-open:rotate-90">›</span></summary>
                        {picker}
                    </details>
                </> : <>
                    <p className="font-medium">Hi {page.lead.first_name}, pick a time that works.</p>
                    {needsPayment ? <p className={`mt-2 text-sm ${theme.muted}`}>{`${formatMoney(page.pay_amount_cents)} confirms your time. Pick a time first; it's held for ${page.hold_minutes} minutes while you pay.${page.refund_rule ? ` ${page.refund_rule}` : ""}`}</p> : null}
                    {page.lead.paid_credit ? <p className={`mt-2 text-sm ${theme.muted}`}>Your payment is in. Pick a time to finish booking.</p> : null}
                    {picker}
                </>}
            </div>
            {page.lead && open?.status !== "booked" && days.length ? <p className={`mt-6 text-center text-xs ${theme.muted}`}>Times are shown in {zone} time.</p> : null}
        </div>
    </main>

    return embed ? <BookingEmbedHeight>{body}</BookingEmbedHeight> : body
}
