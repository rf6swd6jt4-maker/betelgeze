export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1_000

export function whatsappWindowIsOpen(lastInboundAt: string | null | undefined, now = Date.now()) {
    if (!lastInboundAt) return false
    const receivedAt = new Date(lastInboundAt).getTime()
    return Number.isFinite(receivedAt) && receivedAt <= now && now - receivedAt < WHATSAPP_SERVICE_WINDOW_MS
}

export function whatsappReconfirmationNeeded(input: {
    hasWhatsApp: boolean
    lastInboundAt: string | null | undefined
    optedOutAt?: string | null
}, now = Date.now()) {
    return input.hasWhatsApp && !input.optedOutAt && !whatsappWindowIsOpen(input.lastInboundAt, now)
}
