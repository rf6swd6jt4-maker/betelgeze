const DEFAULT_STUCK_AFTER_DAYS = 3

export function getOnboardingStuckAfterDays() {
    const rawValue = process.env.ONBOARDING_STUCK_AFTER_DAYS
    const value = rawValue ? Number(rawValue) : DEFAULT_STUCK_AFTER_DAYS

    return Number.isFinite(value) && value > 0
        ? value
        : DEFAULT_STUCK_AFTER_DAYS
}

export function isOnboardingStuck({
    percentage,
    createdAt,
    lastActivityAt,
    now = new Date(),
    stuckAfterDays = getOnboardingStuckAfterDays(),
}: {
    percentage: number
    createdAt: string
    lastActivityAt?: string | null
    now?: Date
    stuckAfterDays?: number
}) {
    if (percentage >= 100) return false

    const referenceDate = new Date(lastActivityAt ?? createdAt)
    const thresholdMs = stuckAfterDays * 24 * 60 * 60 * 1000

    return now.getTime() - referenceDate.getTime() >= thresholdMs
}
