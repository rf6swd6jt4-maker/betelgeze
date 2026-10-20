import type { AppointmentKind, AppointmentSnapshot } from "./types"

const detailFields = {
    title: "Appointment", contactName: "Appointment contact", contactDetails: "Contact details",
    meetingDetails: "Meeting details", bookingDetails: "Booking details", calendarName: "Calendar",
} as const
const stableFields = ["id", "locationId", "calendarId", "calendarName", "contactId", "contactName", "title", "startTime", "endTime", "timezone", "status", "contactDetails", "meetingDetails", "bookingDetails", "deleted"] as const
export function appointmentSnapshotsEqual(a: AppointmentSnapshot, b: AppointmentSnapshot) {
    return stableFields.every(key => a[key] === b[key])
}
export function isCancelled(snapshot: AppointmentSnapshot) {
    return ["cancelled", "canceled"].includes(snapshot.status.toLowerCase())
}
export function isReminderEligible(snapshot: AppointmentSnapshot) {
    return !snapshot.deleted && ["new", "confirmed"].includes(snapshot.status.toLowerCase())
}

// A single primary notice describes the most consequential change. The summary
// carries the complete latest state when schedule, details and status change together.
export function classifyAppointmentChange(previous: AppointmentSnapshot | null, next: AppointmentSnapshot, options: { baseline?: boolean; eventType?: string; calendarId?: string } = {}): { kinds: AppointmentKind[]; changedDetails: string } {
    const changedDetails = previous ? Object.entries(detailFields)
        .filter(([key]) => previous[key as keyof typeof detailFields] !== next[key as keyof typeof detailFields])
        .map(([key, label]) => `${label}: ${next[key as keyof typeof detailFields]}`).join("; ") : ""
    if ((options.baseline && !previous) || (previous && appointmentSnapshotsEqual(previous, next))) return { kinds: [], changedDetails }
    const removed = next.deleted || (!!options.calendarId && next.calendarId !== options.calendarId)
    if (removed) return { kinds: previous && !previous.deleted ? ["removed"] : [], changedDetails }
    if (!previous || previous.deleted) return { kinds: [isCancelled(next) ? "cancelled" : "added"], changedDetails }
    if (isCancelled(next) && !isCancelled(previous)) return { kinds: ["cancelled"], changedDetails }
    if (isCancelled(next) && isCancelled(previous)) {
        const scheduleChanged = next.startTime !== previous.startTime || next.endTime !== previous.endTime || next.timezone !== previous.timezone
        const detail = ["Status remains cancelled.", scheduleChanged ? `Saved schedule: ${next.startTime} to ${next.endTime} (${next.timezone}).` : "", changedDetails || (next.contactId !== previous.contactId ? "Appointment contact record changed." : "")].filter(Boolean).join(" ")
        return { kinds: ["details_updated"], changedDetails: detail }
    }
    if (next.startTime !== previous.startTime || next.endTime !== previous.endTime || next.timezone !== previous.timezone) return { kinds: ["rescheduled"], changedDetails }
    if (next.status !== previous.status) return { kinds: ["status_updated"], changedDetails }
    if (changedDetails || next.contactId !== previous.contactId) return { kinds: ["details_updated"], changedDetails: changedDetails || "Appointment contact record changed." }
    return { kinds: [], changedDetails }
}

export function reminderDueAt(snapshot: AppointmentSnapshot, leadMinutes: number, now: Date | number | string = Date.now()): string | null {
    const start = Date.parse(snapshot.startTime), current = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now)
    if (!isReminderEligible(snapshot) || !Number.isFinite(start) || !Number.isFinite(current) || start <= current || !Number.isInteger(leadMinutes) || leadMinutes < 5 || leadMinutes > 10080) return null
    return new Date(Math.max(current, start - leadMinutes * 60_000)).toISOString()
}
