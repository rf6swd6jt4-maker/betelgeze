export function normalizeMessageAddress(value: string): string {
    const trimmed = value.trim()
    const [channel, address] = trimmed.includes(":")
        ? trimmed.split(":", 2)
        : ["whatsapp", trimmed]

    const compactAddress = address.replace(/[^\d+]/g, "")

    if (!compactAddress) return ""

    const normalizedAddress = compactAddress.startsWith("+")
        ? compactAddress
        : `+${compactAddress}`

    return `${channel.toLowerCase()}:${normalizedAddress}`
}

export function toMetaWhatsAppRecipient(value: string): string {
    if (!value.includes(":")) return value.replace(/[^\d]/g, "")

    const [, address] = value.split(":", 2)

    return address.replace(/[^\d]/g, "")
}

export function displayMessageAddress(value: string): string {
    if (!value.includes(":")) return value

    const [, address] = value.split(":", 2)

    return address
}

export function formatClientInboundMessage({
    clientName,
    channel,
    from,
    body,
}: {
    clientName: string
    channel: string
    from: string
    body: string
}) {
    return [
        `**${clientName}** via ${channel.toUpperCase()}`,
        "",
        body,
        "",
        `_From ${from}_`,
    ].join("\n")
}
