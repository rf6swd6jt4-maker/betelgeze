import type { AppointmentDetails, AppointmentLeadInformation } from "../ghl-appointments/types"

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
    details: AppointmentDetails | null
}

/** Authorized appointment seed shared by both portal entry paths. */
export type GhlAppointmentEntry = {
    id: string
    calendarId: string
    summary: AppointmentSummary
    notifiedVersion?: number | null
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

function object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function leadInformation(value: unknown): AppointmentLeadInformation | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const input = object(value)
    const bounded = (value: unknown, limit: number) => typeof value === "string" && value.length <= limit ? value.trim() || null : null
    const rawFields = Array.isArray(input.fields) && input.fields.length <= 8 ? input.fields : []
    const fields: AppointmentLeadInformation["fields"] = []
    for (const raw of rawFields) {
        const item = object(raw), fieldId = bounded(item.fieldId, 160), label = bounded(item.label, 200), answer = bounded(item.value, 1000)
        if (!fieldId || !/^[a-zA-Z0-9_-]+$/.test(fieldId) || !label || !answer || /[\u0000-\u001f\u007f]/.test(label)
            || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(answer) || fields.some(field => field.fieldId === fieldId)) continue
        fields.push({ fieldId, label, value: answer })
    }
    return { source: bounded(input.source, 200), type: bounded(input.type, 60), capturedAt: date(input.capturedAt), fields }
}

/** Never pass provider objects through to a public capability or portal response. */
export function appointmentDetails(value: unknown): AppointmentDetails | null {
    const input = object(value)
    if (input.schemaVersion !== 1) return null
    const contact = object(input.contact), meeting = object(input.meeting), source = object(input.source), booking = object(input.booking)
    const nullable = (value: unknown, limit: number) => text(value, limit) || null
    const rawUrl = nullable(meeting.joinUrl, 2048)
    let joinUrl: string | null = null
    try { if (rawUrl) { const url = new URL(rawUrl); if (url.protocol === "https:" && !url.username && !url.password) joinUrl = url.href } } catch { /* A saved invalid URL remains plain meeting text. */ }
    return {
        schemaVersion: 1,
        contact: { phone: nullable(contact.phone, 80), email: nullable(contact.email, 254), company: nullable(contact.company, 200), address: nullable(contact.address, 1300) },
        meeting: { location: nullable(meeting.location, 4000), joinUrl },
        assignedUserId: nullable(input.assignedUserId, 160),
        source: { createdAt: date(source.createdAt), updatedAt: date(source.updatedAt) },
        booking: { text: nullable(booking.text, 500), state: ["available", "not_provided", "not_enabled", "too_large"].includes(String(booking.state)) ? booking.state as AppointmentDetails["booking"]["state"] : "not_provided" },
        ...(Object.hasOwn(input, "lead") ? { lead: leadInformation(input.lead) } : {}),
        formSubmissionState: "unavailable",
    }
}

export function notificationVersion(value: unknown): number | null {
    if (typeof value !== "string" || !/^[1-9][0-9]{0,14}$/.test(value)) return null
    const version = Number(value)
    return Number.isSafeInteger(version) ? version : null
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
        details: appointmentDetails(item.details),
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
