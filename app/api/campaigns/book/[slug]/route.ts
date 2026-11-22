import { after } from "next/server"
import { bookingParams, holdBookingTime, loadBookingEmbedReturn, loadBookingPage } from "@/lib/campaigns/booking"
import { kickFlows } from "@/lib/campaigns/flows-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } })

/** Holds a time on a source's booking page (docs/campaign-booking.md). Same-origin only: the page posts here. */
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
    const { slug } = await context.params
    const origin = new URL(request.url).origin
    const sent = request.headers.get("origin")
    if (sent && sent !== origin) return json(403, { error: "Book from the booking page." })
    let body: Record<string, unknown>
    try {
        const text = await request.text()
        if (text.length > 2_000) return json(413, { error: "Too large." })
        body = JSON.parse(text)
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error()
    } catch {
        return json(400, { error: "Pick a time from the list." })
    }
    const { submission, reference } = bookingParams(body)
    const startsAt = typeof body.starts_at === "string" && !Number.isNaN(Date.parse(body.starts_at)) ? new Date(body.starts_at).toISOString() : null
    if (!startsAt || (!submission && !reference)) return json(400, { error: "Pick a time from the list." })
    const page = await loadBookingPage(slug, submission, reference).catch(() => null)
    if (!page) return json(404, { error: "This booking page is not taking bookings." })
    const returnTo = body.embed === true ? await loadBookingEmbedReturn(page.source_id).catch(() => null) : null
    const result = await holdBookingTime(slug, { submission, reference, startsAt, timeZone: page.time_zone, returnTo }, origin)
    if (result.status < 300) after(() => kickFlows())
    return json(result.status, result.body)
}
