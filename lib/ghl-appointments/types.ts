export type AppointmentKind = "added" | "rescheduled" | "cancelled" | "removed" | "details_updated" | "status_updated" | "reminder"

/** Optional, client-appropriate fields from the exact appointment/contact read.
 * Never substitute contact custom fields for the original booking submission. */
export type LeadFieldMapping = { fieldId: string; label: string }
export type AppointmentLeadInformation = {
    source: string | null
    type: string | null
    capturedAt: string | null
    fields: Array<LeadFieldMapping & { value: string }>
}

export type AppointmentDetails = {
    schemaVersion: 1
    contact: { phone: string | null; email: string | null; company: string | null; address: string | null }
    meeting: { location: string | null; joinUrl: string | null }
    assignedUserId: string | null
    source: { createdAt: string | null; updatedAt: string | null }
    booking: { text: string | null; state: "available" | "not_provided" | "not_enabled" | "too_large" }
    lead?: AppointmentLeadInformation | null
    formSubmissionState: "unavailable"
}

export type AppointmentSnapshot = {
    id: string
    locationId: string
    calendarId: string
    calendarName: string
    contactId: string
    contactName: string
    title: string
    startTime: string
    endTime: string
    timezone: string
    status: string
    contactDetails: string
    meetingDetails: string
    bookingDetails: string
    sourceCreatedAt?: string | null
    sourceUpdatedAt: string | null
    observedAt: string
    deleted: boolean
    details?: AppointmentDetails
}

export type ProviderProfile = {
    locationId: string
    privateToken: string
    calendarId: string
    calendarName: string
    timezone?: string
    includeNotes?: boolean
    leadFieldMapping?: LeadFieldMapping[]
}

export function profileCalendars(profile: { calendarId: string; calendarName: string; calendars?: { id: string; name: string }[] }) {
    return profile.calendars?.length ? profile.calendars : [{ id: profile.calendarId, name: profile.calendarName }]
}
export function profileIncludesCalendar(profile: Parameters<typeof profileCalendars>[0], calendarId: string) {
    return profileCalendars(profile).some(calendar => calendar.id === calendarId)
}
