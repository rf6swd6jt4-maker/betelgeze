import "server-only"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getWorkspaceProviderConfig } from "@/lib/workspace-integrations"
import { createStripeBookingCheckout } from "@/lib/stripe/api"
import { formatAppointment } from "@/lib/campaigns/model"
import type { BookingRules } from "@/lib/campaigns/slots"

export type BookingPage = BookingRules & {
    workspace_name: string
    source_id: string
    meeting_title: string
    meeting_place: "zoom" | "phone" | "google_meet"
    pay_amount_cents: number | null
    hold_minutes: number
    refund_rule: string | null
    lead: { first_name: string; paid_credit: boolean } | null
    open: { id: string; status: "held" | "booked"; starts_at: string; held_until: string | null; checkout_url: string | null } | null
    taken: string[]
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/
const SUBMISSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REFERENCE = /^[a-f0-9]{64}$/

export function bookingParams(input: { submission?: unknown; ref?: unknown; reference?: unknown }) {
    const submission = typeof input.submission === "string" && SUBMISSION.test(input.submission) ? input.submission : null
    const raw = input.ref ?? input.reference
    const reference = typeof raw === "string" && REFERENCE.test(raw) ? raw : null
    return { submission, reference }
}

export async function loadBookingPage(slug: string, submission: string | null, reference: string | null): Promise<BookingPage | null> {
    if (!SLUG.test(slug)) return null
    const { data, error } = await supabaseAdmin.rpc("campaign_booking_page", { p_slug: slug, p_submission: submission, p_reference: reference })
    if (error) throw new Error("Could not open the booking page. Please retry.")
    return (data ?? null) as BookingPage | null
}

const FAILURES: Record<string, { status: number; error: string }> = {
    invalid: { status: 400, error: "Pick a time from the list." },
    time: { status: 409, error: "That time is no longer available. Pick another." },
    taken: { status: 409, error: "Someone just took that time. Pick another." },
    source: { status: 404, error: "This booking page is not taking bookings." },
    lead: { status: 404, error: "We could not find your request. Open this page from the form you filled in." },
    closed: { status: 409, error: "This request is closed. Contact us to book." },
    already_booked: { status: 409, error: "You already have a time booked." },
}

type HoldResult = {
    booking_id: string; status: "held" | "booked"; starts_at: string; held_until: string | null; amount_cents: number | null; workspace_id: string
    meeting_title: string; lead_first_name: string; lead_email: string | null; lead_test: boolean
}

/**
 * Holds the chosen time. Without payment it is booked at once. With payment a Checkout page is made on the
 * workspace's connected Stripe account; if that fails the hold is released so the time is offered again.
 */
export async function holdBookingTime(slug: string, input: { submission: string | null; reference: string | null; startsAt: string; timeZone: string }, origin: string) {
    const { data, error } = await supabaseAdmin.rpc("campaign_booking_hold", { p_slug: slug, p_input: { submission: input.submission, reference: input.reference, starts_at: input.startsAt } })
    if (error) return { status: 500, body: { error: "Could not hold that time. Please retry." } }
    const result = data as HoldResult & { failure?: string }
    if (result.failure) {
        const failure = FAILURES[result.failure] ?? { status: 400, error: "Could not hold that time." }
        return { status: failure.status, body: { error: failure.error } }
    }
    if (result.status === "booked") return { status: 200, body: { status: "booked", starts_at: result.starts_at } }

    const back = new URL(`/book/${slug}`, origin)
    if (input.submission) back.searchParams.set("submission", input.submission)
    if (input.reference) back.searchParams.set("ref", input.reference)
    const done = new URL(back)
    done.searchParams.set("paid", "1")
    try {
        const config = await getWorkspaceProviderConfig(result.workspace_id, "stripe")
        const secretKey = String(config.access_token || config.secret_key || "")
        if (!secretKey) throw new Error("Stripe is not connected")
        const when = formatAppointment(result.starts_at, input.timeZone)
        const checkout = await createStripeBookingCheckout({
            bookingId: result.booking_id,
            workspaceId: result.workspace_id,
            name: result.meeting_title,
            description: `${when}${result.lead_test ? " (test)" : ""}`,
            amount: result.amount_cents ?? 0,
            email: result.lead_email,
            successUrl: done.toString(),
            cancelUrl: back.toString(),
            // Stripe keeps a Checkout page open for at least 30 minutes; a payment after the hold lapses is still
            // honoured (the time is booked if free, otherwise the lead picks again without paying).
            expiresAt: Math.floor(Date.now() / 1000) + 31 * 60,
            secretKey,
        })
        await supabaseAdmin.rpc("campaign_booking_checkout", { p_booking: result.booking_id, p_session: checkout.checkoutSessionId, p_url: checkout.checkoutUrl })
        return { status: 200, body: { status: "held", held_until: result.held_until, checkout_url: checkout.checkoutUrl } }
    } catch {
        await supabaseAdmin.from("campaign_bookings").update({ status: "released", updated_at: new Date().toISOString() }).eq("id", result.booking_id).eq("status", "held").is("paid_at", null)
        return { status: 502, body: { error: "The payment page could not open. Your time was not kept. Please try again." } }
    }
}

/** Applies a completed Checkout for a campaign booking. Returns null when the event is not one. */
export async function applyCampaignCheckout(event: { id: string; type: string }, checkout: Record<string, unknown> | undefined, workspaceId: string) {
    const metadata = checkout?.metadata && typeof checkout.metadata === "object" && !Array.isArray(checkout.metadata) ? checkout.metadata as Record<string, unknown> : null
    const bookingId = typeof metadata?.campaign_booking_id === "string" ? metadata.campaign_booking_id : null
    if (!bookingId || !checkout) return null
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return { ok: true as const, ignored: true }
    if (event.type === "checkout.session.completed" && checkout.payment_status !== "paid") return { ok: true as const, ignored: true }
    const { data, error } = await supabaseAdmin.rpc("campaign_booking_paid", {
        p_input: { booking_id: bookingId, workspace_id: workspaceId, amount_cents: typeof checkout.amount_total === "number" ? checkout.amount_total : null, event_id: event.id, session_id: typeof checkout.id === "string" ? checkout.id : null },
    })
    if (error) return { ok: false as const, error: "Could not record the booking payment" }
    const result = data as { failure?: string; status?: string; duplicate?: boolean }
    if (result.failure) return { ok: false as const, error: "Stripe paid for a booking this workspace does not have" }
    return { ok: true as const, bookingId, status: result.status ?? null, duplicate: result.duplicate === true }
}
