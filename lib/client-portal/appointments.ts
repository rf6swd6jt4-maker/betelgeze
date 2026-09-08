import { APPOINTMENT_MEDIUM_OPTIONS, type AppointmentMedium } from "../appointment-setting"

export type PortalAppointment = {
    id: string
    contactName: string
    phone: string | null
    appointmentAt: string
    timezone: string
    medium: AppointmentMedium
    meetingLink: string | null
    details: { email?: string; service?: string; address?: string; notes?: string }
}

export function safeMeetingLink(value: unknown) {
    if (typeof value !== "string") return null
    try {
        const url = new URL(value)
        return url.protocol === "https:" || url.protocol === "http:" ? url.href : null
    } catch { return null }
}

export function portalAppointment(row: Record<string, unknown>): PortalAppointment | null {
    if (row.workflow_status !== "submitted" || typeof row.appointment_at !== "string" || !Number.isFinite(Date.parse(row.appointment_at))) return null
    const raw = row.details && typeof row.details === "object" ? row.details as Record<string, unknown> : {}
    const details: PortalAppointment["details"] = {}
    for (const key of ["email", "service", "address", "notes"] as const) {
        if (typeof raw[key] === "string" && raw[key].trim()) details[key] = raw[key].trim()
    }
    let timezone = typeof row.appointment_timezone === "string" ? row.appointment_timezone : "UTC"
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format() } catch { timezone = "UTC" }
    return {
        id: String(row.id), contactName: typeof row.contact_name === "string" ? row.contact_name : "Appointment",
        phone: typeof row.phone === "string" ? row.phone : null, appointmentAt: row.appointment_at, timezone,
        medium: APPOINTMENT_MEDIUM_OPTIONS.some((option) => option.key === row.meeting_medium) ? row.meeting_medium as AppointmentMedium : "phone",
        meetingLink: safeMeetingLink(row.meeting_link), details,
    }
}

export function appointmentDateLabels(appointment: PortalAppointment) {
    const date = new Date(appointment.appointmentAt)
    return {
        date: new Intl.DateTimeFormat("en-US", { timeZone: appointment.timezone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(date),
        time: new Intl.DateTimeFormat("en-US", { timeZone: appointment.timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date),
        medium: APPOINTMENT_MEDIUM_OPTIONS.find((option) => option.key === appointment.medium)?.label ?? "Appointment",
    }
}
