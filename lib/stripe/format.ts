export function getStripeCustomerPhone(value?: string | null) {
    const trimmed = value?.trim()

    if (!trimmed) return undefined

    return trimmed.replace(/^whatsapp:/iu, "")
}
