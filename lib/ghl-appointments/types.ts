export type AppointmentKind = "added" | "rescheduled" | "cancelled" | "removed" | "details_updated" | "status_updated" | "reminder"

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
    sourceUpdatedAt: string | null
    observedAt: string
    deleted: boolean
}

export type ProviderProfile = {
    locationId: string
    privateToken: string
    calendarId: string
    calendarName: string
    timezone?: string
    includeNotes?: boolean
}

export function profileCalendars(profile: { calendarId: string; calendarName: string; calendars?: { id: string; name: string }[] }) {
    return profile.calendars?.length ? profile.calendars : [{ id: profile.calendarId, name: profile.calendarName }]
}
export function profileIncludesCalendar(profile: Parameters<typeof profileCalendars>[0], calendarId: string) {
    return profileCalendars(profile).some(calendar => calendar.id === calendarId)
}
