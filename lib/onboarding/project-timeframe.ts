const DAY_MS = 24 * 60 * 60 * 1000

export type ProjectTimeframeUnit = "days" | "weeks" | "months"

export function getProjectTimeframeDays(
    amount: number,
    unit: ProjectTimeframeUnit
) {
    if (!Number.isFinite(amount) || amount <= 0) return null

    if (unit === "weeks") return Math.round(amount * 7)
    if (unit === "months") return Math.round(amount * 30)

    return Math.round(amount)
}

export function splitProjectTimeframeDays(days?: number | null): {
    amount: number | ""
    unit: ProjectTimeframeUnit
} {
    if (!days || days <= 0) {
        return {
            amount: "",
            unit: "days",
        }
    }

    if (days % 30 === 0) {
        return {
            amount: days / 30,
            unit: "months",
        }
    }

    if (days % 7 === 0) {
        return {
            amount: days / 7,
            unit: "weeks",
        }
    }

    return {
        amount: days,
        unit: "days",
    }
}

export function getProjectDeadlineTimestamp({
    days,
    from = new Date(),
}: {
    days?: number | null
    from?: Date
}) {
    if (!days) return undefined

    return from.getTime() + days * DAY_MS
}
