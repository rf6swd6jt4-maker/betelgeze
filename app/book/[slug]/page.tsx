import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { bookingParams, loadBookingLogo, loadBookingPage } from "@/lib/campaigns/booking"
import { ClientBrandLogo } from "@/components/client-branding/ClientBrandLogo"
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
    const logoSrc = await loadBookingLogo(page.source_id).catch(() => null)
    const zone = timeZoneLabels[page.time_zone as keyof typeof timeZoneLabels] ?? page.time_zone
    const needsPayment = page.pay_amount_cents !== null && !page.lead?.paid_credit
    const open = page.open
    const held = open?.status === "held" && open.checkout_url ? open : null
    // The held time is not offered again: it is already theirs until it lapses.
    const days = page.lead && !(open?.status === "booked") ? bookingDays(page, new Date(), held ? [...page.taken, held.starts_at] : page.taken) : []
    const heldUntil = held ? new Intl.DateTimeFormat("en-US", { timeZone: page.time_zone, hour: "numeric", minute: "2-digit" }).format(new Date(held.held_until ?? held.starts_at)) : ""

    return <main className="min-h-screen bg-[#f6f6f4] px-4 py-10 text-neutral-900 sm:py-16">
        <div className="mx-auto w-full max-w-xl">
            <ClientBrandLogo logoSrc={logoSrc} workspaceName={page.workspace_name} className="h-8 max-w-full" fallbackClassName="block max-w-full truncate text-sm font-semibold text-neutral-700" />
            <h1 className="mt-6 text-2xl font-semibold tracking-tight text-balance">{page.meeting_title}</h1>
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
                : held ? <>
                    <p className="text-sm text-neutral-500">{`Your time is held, ${page.lead.first_name}`}</p>
                    <p className="mt-1 text-xl font-semibold">{formatAppointment(held.starts_at, page.time_zone)}</p>
                    <p className="mt-2 text-sm text-neutral-600">{`It's yours until ${heldUntil}. Pay ${formatMoney(page.pay_amount_cents)} to confirm it.${page.refund_rule ? ` ${page.refund_rule}` : ""}`}</p>
                    <a href={held.checkout_url!} className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-xl bg-neutral-900 px-4 font-medium text-white hover:bg-neutral-800">Pay {formatMoney(page.pay_amount_cents)} to confirm</a>
                    <details className="group mt-5 border-t border-black/10 pt-4">
                        <summary className="cursor-pointer list-none text-sm font-medium text-neutral-700 hover:text-neutral-950 [&::-webkit-details-marker]:hidden">Pick a different time <span aria-hidden="true" className="inline-block transition group-open:rotate-90">›</span></summary>
                        <BookingPicker slug={slug} submission={submission} reference={reference} days={days} payLabel={needsPayment ? formatMoney(page.pay_amount_cents) : null} />
                    </details>
                </> : <>
                    <p className="font-medium">Hi {page.lead.first_name}, pick a time that works.</p>
                    {needsPayment ? <p className="mt-2 text-sm text-neutral-600">{`${formatMoney(page.pay_amount_cents)} confirms your time. Pick a time first; it's held for ${page.hold_minutes} minutes while you pay.${page.refund_rule ? ` ${page.refund_rule}` : ""}`}</p> : null}
                    {page.lead.paid_credit ? <p className="mt-2 text-sm text-neutral-600">Your payment is in. Pick a time to finish booking.</p> : null}
                    <BookingPicker slug={slug} submission={submission} reference={reference} days={days} payLabel={needsPayment ? formatMoney(page.pay_amount_cents) : null} />
                </>}
            </div>
            {page.lead && open?.status !== "booked" && days.length ? <p className="mt-6 text-center text-xs text-neutral-500">Times are shown in {zone} time.</p> : null}
        </div>
    </main>
}
