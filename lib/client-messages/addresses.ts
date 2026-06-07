const TRUNK_ZERO_COUNTRY_CODES = [
    "27",
    "31",
    "32",
    "33",
    "353",
    "44",
    "49",
    "61",
    "64",
]

function normalizePhoneNumber(value: string): string {
    let compactAddress = value
        .replace(/\b(?:ext|extension|x)\.?\s*\d+$/iu, "")
        .replace(/[^\d+]/g, "")
        .replace(/(?!^)\+/g, "")

    if (compactAddress.startsWith("00")) {
        compactAddress = `+${compactAddress.slice(2)}`
    }

    if (!compactAddress) return ""

    if (!compactAddress.startsWith("+")) {
        if (/^08\d{7,9}$/.test(compactAddress)) {
            compactAddress = `+353${compactAddress.slice(1)}`
        } else {
            compactAddress = `+${compactAddress}`
        }
    }

    for (const countryCode of TRUNK_ZERO_COUNTRY_CODES) {
        const trunkPrefix = `+${countryCode}0`

        if (compactAddress.startsWith(trunkPrefix)) {
            return `+${countryCode}${compactAddress.slice(trunkPrefix.length)}`
        }
    }

    return compactAddress
}

function getChannelAndAddress(value: string) {
    const trimmed = value.trim()
    const [channel, address] = trimmed.includes(":")
        ? trimmed.split(":", 2)
        : ["whatsapp", trimmed]

    return {
        channel: channel.toLowerCase(),
        address,
    }
}

export function normalizeMessageAddress(value: string): string {
    const { channel, address } = getChannelAndAddress(value)
    const normalizedAddress = normalizePhoneNumber(address)

    if (!normalizedAddress) return ""

    return `${channel}:${normalizedAddress}`
}

export function getEquivalentMessageAddresses(value: string): string[] {
    const normalizedAddress = normalizeMessageAddress(value)

    if (!normalizedAddress) return []

    const { channel, address } = getChannelAndAddress(normalizedAddress)
    const addresses = new Set([normalizedAddress])

    for (const countryCode of TRUNK_ZERO_COUNTRY_CODES) {
        const countryPrefix = `+${countryCode}`

        if (address.startsWith(countryPrefix)) {
            addresses.add(
                `${channel}:${countryPrefix}0${address.slice(countryPrefix.length)}`
            )
        }
    }

    return [...addresses]
}

export function getMessageAddressFormatHint(value: string): string | null {
    const normalizedAddress = normalizeMessageAddress(value)
    const trimmed = value.trim()

    if (!trimmed) return "Add a WhatsApp phone number."
    if (!normalizedAddress) return "Use digits with a country code, like +353899831234."

    const displayedNormalizedAddress = displayMessageAddress(normalizedAddress)
    const displayedInputAddress = displayMessageAddress(trimmed)

    if (displayedInputAddress !== displayedNormalizedAddress) {
        return `Saved as ${displayedNormalizedAddress}.`
    }

    return null
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
    body,
    showClientName = true,
}: {
    clientName: string
    body: string
    showClientName?: boolean
}) {
    return showClientName ? [`**${clientName}**`, body].join("\n") : body
}
