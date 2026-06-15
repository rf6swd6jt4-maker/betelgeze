const DAY_MS = 24 * 60 * 60 * 1000

export function parseProjectTimeframeDays(value?: string | null) {
    const normalized = value?.trim().toLowerCase()

    if (!normalized) return null

    const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(day|days|week|weeks)$/)

    if (!match) return null

    const amount = Number(match[1])

    if (!Number.isFinite(amount) || amount <= 0) return null

    const unit = match[2]

    return unit.startsWith("week") ? Math.round(amount * 7) : Math.round(amount)
}

export function getProjectDeadlineTimestamp({
    timeframe,
    from = new Date(),
}: {
    timeframe?: string | null
    from?: Date
}) {
    const days = parseProjectTimeframeDays(timeframe)

    if (!days) return undefined

    return from.getTime() + days * DAY_MS
}
