import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { bookingParams, loadBookingPage } from "@/lib/campaigns/booking"
import { bookingDays } from "@/lib/campaigns/slots"
import { formatAppointment, formatMoney, meetingPlaceLabels, timeZoneLabels } from "@/lib/campaigns/model"
import { BookingPicker, BookingConfirming } from "@/components/campaigns/BookingPicker"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Book a time", robots: { index: false, follow: false } }

/** A source's public booking page (docs/campaign-booking.md). Agency-branded; no Betelgeze branding. */
export default async function BookingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const [{ slug }, query] = await Promise.all([params, searchParams])
    const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value
    const { submission, reference } = bookingParams({ submission: first(query.submission), ref: first(query.ref) })
    const page = await loadBookingPage(slug, submission, reference)
    if (!page) notFound()
    const zone = timeZoneLabels[page.time_zone as keyof typeof timeZoneLabels] ?? page.time_zone
    const needsPayment = page.pay_amount_cents !== null && !page.lead?.paid_credit
    const open = page.open
    const days = page.lead && !(open?.status === "booked") ? bookingDays(page, new Date(), page.taken) : []

    return <main className="min-h-screen bg-[#f6f6f4] px-4 py-10 text-neutral-900 sm:py-16">
        <div className="mx-auto w-full max-w-xl">
            <p className="text-sm font-medium text-neutral-500">{page.workspace_name}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance">{page.meeting_title}</h1>
            <p className="mt-1 text-sm text-neutral-600">{page.meeting_minutes} minutes · {meetingPlaceLabels[page.meeting_place].split(",")[0]} · {zone} time</p>

            <div className="mt-8 rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
                {!page.lead ? <>
                    <p className="font-medium">Open this page from the form</p>
                    <p className="mt-2 text-sm text-neutral-600">This booking page works with the form you filled in, so we know who the time is for. Go back to the form and submit it, and it brings you here.</p>
                </> : open?.status === "booked" ? <>
                    <p className="text-sm text-neutral-500">{`You're booked, ${page.lead.first_name}`}</p>
                    <p className="mt-1 text-xl font-semibold">{formatAppointment(open.starts_at, page.time_zone)}</p>
                    <p className="mt-3 text-sm text-neutral-600">{page.meeting_place === "phone" ? "We'll call you at that time on the number you gave us." : `We'll send the ${meetingPlaceLabels[page.meeting_place]} link before the call.`}</p>
                </> : open?.status === "held" && first(query.paid) === "1" ? <BookingConfirming when={formatAppointment(open.starts_at, page.time_zone)} />
                : <>
                    <p className="font-medium">Hi {page.lead.first_name}, pick a time that works.</p>
                    {needsPayment ? <p className="mt-2 text-sm text-neutral-600">{`${formatMoney(page.pay_amount_cents)} confirms your time. Pick a time first; it's held for ${page.hold_minutes} minutes while you pay.${page.refund_rule ? ` ${page.refund_rule}` : ""}`}</p> : null}
                    {page.lead.paid_credit ? <p className="mt-2 text-sm text-neutral-600">Your payment is in. Pick a time to finish booking.</p> : null}
                    {open?.status === "held" && open.checkout_url ? <div className="mt-4 rounded-xl bg-neutral-100 p-4 text-sm">
                        <p><span className="font-medium">{formatAppointment(open.starts_at, page.time_zone)}</span> is held for you until {new Intl.DateTimeFormat("en-US", { timeZone: page.time_zone, hour: "numeric", minute: "2-digit" }).format(new Date(open.held_until ?? open.starts_at))}.</p>
                        <a href={open.checkout_url} className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-neutral-900 px-4 font-medium text-white hover:bg-neutral-800">Pay {formatMoney(page.pay_amount_cents)} to confirm</a>
                        <p className="mt-2 text-neutral-500">Or pick a different time below.</p>
                    </div> : null}
                    <BookingPicker slug={slug} submission={submission} reference={reference} days={days} payLabel={needsPayment ? formatMoney(page.pay_amount_cents) : null} />
                </>}
            </div>
            <p className="mt-6 text-center text-xs text-neutral-500">Times are shown in {zone} time.</p>
        </div>
    </main>
}
