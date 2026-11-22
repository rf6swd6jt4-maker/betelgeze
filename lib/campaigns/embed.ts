/**
 * Embedding a booking page in a funnel (docs/campaign-booking.md, "Embedding"). Shared by the framing header in
 * next.config.ts, the hold route and the page, so the sites that may frame it, receive its height and get visitors back
 * from Stripe are one list.
 */
export const BOOKING_FRAME_ORIGINS = ["https://scaylup.com"] as const

/** The header value that lets the app itself and the funnel sites frame /book, and nothing else. */
export const BOOKING_FRAME_ANCESTORS = `frame-ancestors 'self' ${BOOKING_FRAME_ORIGINS.join(" ")}`

/** The message an embedded page posts to its parent whenever its height changes. */
export const BOOKING_HEIGHT_MESSAGE = "betelgeze:booking-height"

export const isBookingFrameOrigin = (origin: string) => (BOOKING_FRAME_ORIGINS as readonly string[]).includes(origin)

/**
 * Where Stripe sends an embedded visitor back to: the funnel's `book.html` beside the source's landing page
 * (https://scaylup.com/teardown/ → https://scaylup.com/teardown/book.html). Null when the landing page is not on a site
 * allowed to frame the booking page; the visitor then returns to the booking page itself.
 */
export function bookingEmbedReturnUrl(pageUrl: string | null | undefined) {
    if (!pageUrl) return null
    let url: URL
    try { url = new URL(pageUrl) } catch { return null }
    if (url.protocol !== "https:" || !isBookingFrameOrigin(url.origin)) return null
    const last = url.pathname.split("/").pop() ?? ""
    const folder = url.pathname.endsWith("/") ? url.pathname : last.includes(".") ? url.pathname.slice(0, url.pathname.length - last.length) : `${url.pathname}/`
    return `${url.origin}${folder}book.html`
}
