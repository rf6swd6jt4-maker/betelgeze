type WhatsAppIntegrationState = {
    enabled?: unknown
    mode?: unknown
    connection_status?: unknown
    last_verified_at?: unknown
}

export function whatsappIntegrationIsReady(value: unknown, legacyCredentialsAvailable: boolean) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const integration = value as WhatsAppIntegrationState
    if (integration.enabled !== true) return false
    if (integration.mode === "platform_legacy") return legacyCredentialsAvailable
    return integration.connection_status === "connected"
        && typeof integration.last_verified_at === "string"
        && integration.last_verified_at.trim().length > 0
}

export function whatsappCommunicationMethodLabel(verified: boolean, number: string | null | undefined) {
    if (!verified) return "WhatsApp · unavailable"
    const displayNumber = number?.trim()
    return displayNumber ? `WhatsApp · ${displayNumber}` : "WhatsApp"
}
