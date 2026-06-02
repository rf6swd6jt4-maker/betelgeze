export function normalizeMessageAddress(value: string): string {
    const trimmed = value.trim()
    const [channel, address] = trimmed.includes(":")
        ? trimmed.split(":", 2)
        : ["sms", trimmed]

    const compactAddress = address.replace(/[^\d+]/g, "")

    if (!compactAddress) return ""

    return `${channel.toLowerCase()}:${compactAddress}`
}

export function toTwilioAddress(value: string): string {
    if (!value.includes(":")) return value

    const [channel, address] = value.split(":", 2)

    return channel === "sms" ? address : `${channel}:${address}`
}

export function displayMessageAddress(value: string): string {
    if (!value.includes(":")) return value

    const [channel, address] = value.split(":", 2)

    return `${channel.toUpperCase()} ${address}`
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
