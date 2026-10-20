/** Only public, appointment-specific fields may leave the summary reader. */
export type AppointmentSummary = {
    reference: string
    title: string
    calendarName: string
    contactName: string
    startTime: string | null
    endTime: string | null
    timezone: string
    timezoneKnown: boolean
    status: string
    removed: boolean
    contactDetails: string
    meetingDetails: string
    bookingDetails: string
    observedAt: string | null
    version: number
}

export function appointmentSummaryToken(value: unknown) {
    return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null
}

export function appointmentSummaryHost(value: string | null) {
    // Public capabilities require a verified DNS hostname, never a forwarded URL.
    if (!value || value.length > 253 || !/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/i.test(value)) return null
    return value.toLowerCase()
}

function text(value: unknown, limit = 4000) {
    return typeof value === "string" ? value.trim().slice(0, limit) : ""
}

function date(value: unknown) {
    if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) return null
    return new Date(value).toISOString()
}

export function appointmentSummary(value: unknown): AppointmentSummary | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const row = value as Record<string, unknown>
    const snapshot = row.snapshot
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null
    const item = snapshot as Record<string, unknown>
    if (!text(item.id, 200)) return null
    let timezone = text(item.timezone, 100)
    let timezoneKnown = Boolean(timezone)
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format() } catch { timezoneKnown = false }
    if (!timezoneKnown) timezone = "UTC"
    return {
        reference: text(item.id, 200).slice(-8),
        title: text(item.title, 300) || "Appointment",
        calendarName: text(item.calendarName, 300) || text(row.calendarName, 300) || "Connected calendar",
        contactName: text(item.contactName, 300) || "Not provided",
        startTime: date(item.startTime),
        endTime: date(item.endTime),
        timezone,
        timezoneKnown,
        status: text(item.status, 100) || "Unknown",
        removed: Boolean(row.removedAt) || item.deleted === true,
        contactDetails: text(item.contactDetails),
        meetingDetails: text(item.meetingDetails),
        bookingDetails: text(item.bookingDetails),
        observedAt: date(row.observedAt) ?? date(item.observedAt),
        version: typeof row.version === "number" && Number.isSafeInteger(row.version) && row.version > 0 ? row.version : 1,
    }
}

export function summaryDateTime(value: string | null, timezone: string) {
    if (!value) return "Not provided"
    return new Intl.DateTimeFormat("en-US", {
        timeZone: timezone, year: "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(new Date(value))
}

export function summaryStatus(summary: Pick<AppointmentSummary, "removed" | "status">) {
    if (summary.removed) return { label: "Removed from calendar", tone: "grey" as const, explanation: "This appointment was removed from the connected calendar. Its last saved details are retained here." }
    const status = summary.status.toLowerCase().replace(/[ _-]/g, "")
    if (status === "cancelled" || status === "canceled") return { label: "Cancelled", tone: "red" as const, explanation: "This appointment has been cancelled. Its saved details are retained here." }
    if (status === "confirmed") return { label: "Confirmed", tone: "green" as const, explanation: null }
    if (status === "showed" || status === "completed") return { label: status === "showed" ? "Attended" : "Completed", tone: "green" as const, explanation: null }
    if (status === "noshow") return { label: "No show", tone: "red" as const, explanation: null }
    if (status === "new" || status === "pending") return { label: status === "new" ? "New" : "Pending", tone: "yellow" as const, explanation: null }
    return { label: summary.status, tone: "grey" as const, explanation: null }
}
