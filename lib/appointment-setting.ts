import type { RelationshipRecord } from "@/lib/relationships"

export const APPOINTMENT_MEDIUM_OPTIONS = [
    { key: "phone", label: "Phone call", description: "The setter books a phone call with your team." },
    { key: "google_meet", label: "Google Meet", description: "The setter adds a Google Meet link to the appointment." },
    { key: "zoom", label: "Zoom", description: "The setter adds a Zoom link to the appointment." },
] as const

export type AppointmentMedium = (typeof APPOINTMENT_MEDIUM_OPTIONS)[number]["key"]

export const APPOINTMENT_FIELD_OPTIONS = [
    { key: "phone", label: "Phone number", description: "The best US number for reaching the lead.", inputType: "tel", placeholder: "(555) 123-4567" },
    { key: "email", label: "Email address", description: "Where the lead can receive confirmations.", inputType: "email", placeholder: "lead@example.com" },
    { key: "service", label: "Service requested", description: "The job or service the lead is interested in.", inputType: "text", placeholder: "Roof inspection" },
    { key: "address", label: "Property address", description: "The address connected to the requested work.", inputType: "text", placeholder: "123 Main St, Dallas, TX" },
    { key: "notes", label: "Setter notes", description: "Short context the client should know before the appointment.", inputType: "text", placeholder: "Decision-maker will attend" },
] as const

export type AppointmentFieldKey = (typeof APPOINTMENT_FIELD_OPTIONS)[number]["key"]
export type AppointmentUpdateField = "contact_name" | "appointment_date" | "appointment_time" | "appointment_timezone" | "meeting_medium" | "meeting_link" | `detail:${AppointmentFieldKey}`
export type AppointmentDraftChanges = Partial<Record<AppointmentUpdateField, string>>
export type AppointmentRequestedField = { key: AppointmentFieldKey; required: boolean }

export type AppointmentSettingConfiguration = {
    mediums: AppointmentMedium[]
    fields: AppointmentRequestedField[]
}

export const DEFAULT_APPOINTMENT_SETTING_CONFIGURATION: AppointmentSettingConfiguration = {
    mediums: ["phone"],
    fields: [{ key: "phone", required: true }],
}

const APPOINTMENT_MEDIUM_KEYS = new Set<AppointmentMedium>(APPOINTMENT_MEDIUM_OPTIONS.map((option) => option.key))
const APPOINTMENT_FIELD_KEYS = new Set<AppointmentFieldKey>(APPOINTMENT_FIELD_OPTIONS.map((option) => option.key))

export function normalizeAppointmentMediums(value: unknown): AppointmentMedium[] {
    if (!Array.isArray(value)) return []
    return [...new Set(value.filter((item): item is AppointmentMedium => typeof item === "string" && APPOINTMENT_MEDIUM_KEYS.has(item as AppointmentMedium)))].slice(0, APPOINTMENT_MEDIUM_OPTIONS.length)
}

export function normalizeAppointmentRequestedFields(value: unknown, maximum = 4): AppointmentRequestedField[] {
    if (!Array.isArray(value)) return []
    const seen = new Set<AppointmentFieldKey>()
    const normalized: AppointmentRequestedField[] = []
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue
        const key = (item as { key?: unknown }).key
        if (typeof key !== "string" || !APPOINTMENT_FIELD_KEYS.has(key as AppointmentFieldKey) || seen.has(key as AppointmentFieldKey)) continue
        seen.add(key as AppointmentFieldKey)
        normalized.push({ key: key as AppointmentFieldKey, required: Boolean((item as { required?: unknown }).required) })
        if (normalized.length >= maximum) break
    }
    return normalized
}

export function formatUsPhone(value: string) {
    const digits = value.replace(/\D/g, "")
    const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
    if (national.length !== 10) return null
    return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
}

export type AppointmentSettingAppointment = {
    id: string
    workspace_id: string
    relationship_id: string
    service_id: string
    contact_name: string | null
    phone: string | null
    appointment_at: string | null
    appointment_date: string | null
    appointment_time: string | null
    appointment_timezone: string
    meeting_medium: AppointmentMedium
    meeting_link: string | null
    details: Partial<Record<Exclude<AppointmentFieldKey, "phone">, string>>
    workflow_status: "draft" | "submitted"
    submitted_at: string | null
    submitted_by: string | null
    submission_message_id: string | null
    created_by: string | null
    updated_by: string | null
    created_at: string
    updated_at: string
}

export type AppointmentSettingInput = {
    contactName: string
    appointmentAt: string
    appointmentTimezone: string
    meetingMedium: AppointmentMedium
    meetingLink: string
    details: Partial<Record<AppointmentFieldKey, string>>
}

export function appointmentFieldValue(row: AppointmentSettingAppointment, field: AppointmentUpdateField): string {
    if (field === "detail:phone") return row.phone ?? ""
    if (field.startsWith("detail:")) return String(row.details[field.slice(7) as Exclude<AppointmentFieldKey, "phone">] ?? "")
    const value = row[field as Exclude<AppointmentUpdateField, `detail:${string}`>] ?? ""
    return field === "appointment_time" ? value.slice(0, 5) : value
}

export function appointmentWithChanges(row: AppointmentSettingAppointment, changes: AppointmentDraftChanges): AppointmentSettingAppointment {
    const next = { ...row, details: { ...row.details } }
    for (const [field, value] of Object.entries(changes)) {
        if (field === "detail:phone") next.phone = value
        else if (field.startsWith("detail:")) next.details[field.slice(7) as Exclude<AppointmentFieldKey, "phone">] = value
        else Object.assign(next, { [field]: value })
    }
    return next
}

// Find real instants matching a local appointment time, including DST gaps and
// repeated hours. Never use the setter's system timezone to interpret a booking.
export function appointmentTimeCandidates(date: string, time: string, timezone: string): number[] {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time.slice(0, 5))) return []
    const wall = Date.parse(`${date}T${time.slice(0, 5)}:00Z`)
    if (!Number.isFinite(wall)) return []
    try {
        const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        const local = (instant: number) => {
            const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]))
            return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`
        }
        const offsets = new Set<number>()
        for (const hours of [-36, -12, 0, 12, 36]) {
            const sample = wall + hours * 3_600_000
            offsets.add(Date.parse(local(sample)) - sample)
        }
        return [...offsets].map((offset) => wall - offset).filter((instant) => local(instant) === `${date}T${time.slice(0, 5)}:00Z`).sort((a, b) => a - b)
    } catch { return [] }
}

export function appointmentReadiness(row: AppointmentSettingAppointment, configuration: AppointmentSettingConfiguration) {
    const issues: Array<{ field: AppointmentUpdateField; message: string }> = []
    if (!row.contact_name?.trim()) issues.push({ field: "contact_name", message: "Add the lead's name." })
    else if (row.contact_name.trim().length > 160) issues.push({ field: "contact_name", message: "Use a name of 160 characters or fewer." })
    const date = row.appointment_date ?? ""
    const parsedDate = new Date(`${date}T12:00:00Z`)
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date
    if (!validDate) issues.push({ field: "appointment_date", message: "Choose a valid appointment date." })
    const time = row.appointment_time?.slice(0, 5) ?? ""
    const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
    if (!validTime) issues.push({ field: "appointment_time", message: "Choose an appointment time." })
    let validZone = Boolean(row.appointment_timezone)
    try { new Intl.DateTimeFormat("en", { timeZone: row.appointment_timezone }) } catch { validZone = false }
    if (!validZone) issues.push({ field: "appointment_timezone", message: "Choose the appointment timezone." })
    if (validDate && validTime && validZone) {
        const candidates = appointmentTimeCandidates(date, time, row.appointment_timezone)
        if (candidates.length !== 1) issues.push({ field: "appointment_time", message: candidates.length ? "This time occurs twice when the clocks change. Choose a time outside the repeated hour." : "This time does not exist when the clocks change. Choose another time." })
    }
    if (!configuration.mediums.includes(row.meeting_medium)) issues.push({ field: "meeting_medium", message: "Choose an available meeting type." })
    if (row.meeting_medium !== "phone") {
        try {
            if (!row.meeting_link || row.meeting_link.length > 2_000 || new URL(row.meeting_link).protocol !== "https:") throw new Error()
        } catch { issues.push({ field: "meeting_link", message: "Add a valid HTTPS meeting link." }) }
    }
    for (const field of configuration.fields) {
        const key: AppointmentUpdateField = `detail:${field.key}`
        const value = appointmentFieldValue(row, key).trim()
        const label = APPOINTMENT_FIELD_OPTIONS.find((option) => option.key === field.key)!.label
        if (!value && field.required) issues.push({ field: key, message: `Add ${label.toLowerCase()}.` })
        else if (value && field.key === "phone" && !formatUsPhone(value)) issues.push({ field: key, message: "Use a valid 10-digit US phone number." })
        else if (value && field.key === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) issues.push({ field: key, message: "Use a valid email address." })
        else if (value.length > (field.key === "notes" ? 1_000 : field.key === "address" ? 300 : 200)) issues.push({ field: key, message: `${label} is too long.` })
    }
    return issues
}

export type AppointmentView = "drafts" | "upcoming" | "past"

export function appointmentView(row: AppointmentSettingAppointment, now: number): AppointmentView {
    return row.workflow_status === "draft" ? "drafts" : Date.parse(row.appointment_at ?? "") >= now ? "upcoming" : "past"
}

export function sortAppointmentWork(rows: AppointmentSettingAppointment[], now: number) {
    const rank = { drafts: 0, upcoming: 1, past: 2 }
    return [...rows].sort((a, b) => {
        const category = appointmentView(a, now)
        const other = appointmentView(b, now)
        if (category !== other) return rank[category] - rank[other]
        if (category === "drafts") return b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)
        const order = (a.appointment_at ?? "").localeCompare(b.appointment_at ?? "")
        return (category === "past" ? -order : order) || a.id.localeCompare(b.id)
    })
}

export function formatAppointmentNotification(input: {
    contactName: string
    appointmentDate: string
    appointmentTime: string
    appointmentTimezone: string
    meetingMedium: AppointmentMedium
    meetingLink?: string | null
    clientPortalUrl?: string | null
}) {
    const date = new Date(`${input.appointmentDate}T12:00:00Z`)
    const [hourText, minuteText] = input.appointmentTime.split(":")
    const hour = Number(hourText)
    const minute = Number(minuteText)
    const dateLabel = Number.isNaN(date.getTime())
        ? input.appointmentDate
        : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date)
    const timeLabel = Number.isInteger(hour) && Number.isInteger(minute)
        ? `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`
        : input.appointmentTime
    const mediumLabel = APPOINTMENT_MEDIUM_OPTIONS.find((option) => option.key === input.meetingMedium)?.label ?? input.meetingMedium
    return [
        "A new appointment has been booked.",
        "",
        `Lead: ${input.contactName}`,
        `Date: ${dateLabel}`,
        `Time: ${timeLabel} (${input.appointmentTimezone.replaceAll("_", " ")})`,
        `Medium: ${mediumLabel}`,
        ...(input.meetingMedium !== "phone" && input.meetingLink ? [`Meeting link: ${input.meetingLink}`] : []),
        ...(input.clientPortalUrl ? ["", `Check your client portal: ${input.clientPortalUrl}`] : []),
    ].join("\n")
}

export function appointmentSettingDetailHref(workspaceSlug: string, relationshipId: string) {
    return `/${workspaceSlug}/appointment-setting/${relationshipId}`
}

export function filterAppointmentSettingRelationships(
    relationships: readonly RelationshipRecord[],
    accessibleIds: ReadonlySet<string> | null,
    appointmentSettingRelationshipIds: ReadonlySet<string>,
) {
    return relationships.filter((relationship) => (
        relationship.lifecycle_phase === "retention"
        && relationship.status !== "archived"
        && appointmentSettingRelationshipIds.has(relationship.id)
        && (!accessibleIds || accessibleIds.has(relationship.id))
    ))
}
