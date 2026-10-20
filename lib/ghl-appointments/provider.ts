import { GhlError, ghlHttpError, readGhlJson } from "../client-portal/ghl-provider"
import type { AppointmentSnapshot, ProviderProfile } from "./types"

const API = "https://services.leadconnectorhq.com"
export const isGhlIdentifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value)
const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new GhlError("response")
    return value as Record<string, unknown>
}
function text(value: unknown, maximum: number, fallback = "Not provided") {
    if (value === undefined || value === null || value === "") return fallback
    if (typeof value !== "string" || value.length > maximum) throw new GhlError("response")
    return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() || fallback
}
function timestamp(value: unknown): string {
    if (typeof value !== "string" || value.length > 64 || !/(Z|[+-]\d\d:\d\d)$/i.test(value) || !Number.isFinite(Date.parse(value))) throw new GhlError("response")
    return new Date(value).toISOString()
}
function timezone(value: unknown): string {
    if (typeof value !== "string" || value.length > 100) throw new GhlError("timezone")
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return value } catch { throw new GhlError("timezone") }
}
async function withProvider<T>(profile: ProviderProfile, fetcher: typeof fetch, work: (request: (path: string, check: "location" | "calendars" | "contacts" | "events", allowMissing?: boolean) => Promise<Record<string, unknown> | null>, location: Record<string, unknown>) => Promise<T>) {
    if (!isGhlIdentifier(profile.locationId) || !isGhlIdentifier(profile.calendarId) || !/^[\x21-\x7e]{20,4096}$/.test(profile.privateToken)) throw new GhlError("credentials")
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000)
    const request = async (path: string, check: "location" | "calendars" | "contacts" | "events", allowMissing = false) => {
        const response = await fetcher(`${API}${path}`, { redirect: "error", cache: "no-store", signal: controller.signal, headers: { Authorization: `Bearer ${profile.privateToken}`, Version: "v3", Accept: "application/json" } })
        if (!response.ok) {
            await response.body?.cancel()
            if (response.status === 404 && allowMissing) return null
            throw ghlHttpError(response.status, check, "calendar")
        }
        return readGhlJson(response, 1_048_576)
    }
    try {
        const location = record((await request(`/locations/${encodeURIComponent(profile.locationId)}`, "location"))?.location)
        if (location.id !== profile.locationId) throw new GhlError("location")
        return await work(request, location)
    } catch (error) { controller.abort(); throw error instanceof GhlError ? error : new GhlError("unavailable") }
    finally { clearTimeout(timer) }
}

// Read an occurrence by its exact event ID; never replace it with a recurring
// series/master ID. Absence requires a verified-location 404 or an explicit
// exact-ID deleted flag, never a failed read.
export async function fetchAppointment(profile: ProviderProfile, id: string, fetcher: typeof fetch = fetch): Promise<AppointmentSnapshot | null> {
    if (!isGhlIdentifier(id)) throw new GhlError("response")
    return withProvider(profile, fetcher, async (request, location) => {
        const response = await request(`/calendars/events/appointments/${encodeURIComponent(id)}`, "events", true)
        if (response === null) return null
        const event = record(response.event)
        if (event.id !== id || event.locationId !== profile.locationId) throw new GhlError("location")
        if (event.deleted === true) return null
        if (!isGhlIdentifier(event.calendarId)) throw new GhlError("response")
        const startTime = timestamp(event.startTime), endTime = timestamp(event.endTime)
        if (Date.parse(endTime) <= Date.parse(startTime)) throw new GhlError("response")
        if (event.contactId != null && event.contactId !== "" && !isGhlIdentifier(event.contactId)) throw new GhlError("response")
        const contactId = typeof event.contactId === "string" ? event.contactId : ""
        const [calendarResponse, contactResponse] = await Promise.all([
            request(`/calendars/${encodeURIComponent(event.calendarId)}`, "calendars"),
            contactId ? request(`/contacts/${encodeURIComponent(contactId)}`, "contacts") : Promise.resolve(null),
        ])
        const calendar = record(calendarResponse?.calendar)
        if (calendar.id !== event.calendarId || (calendar.locationId !== undefined && calendar.locationId !== profile.locationId)) throw new GhlError("location")
        const contact = contactResponse ? record(contactResponse.contact) : null
        if (contact && (contact.id !== contactId || contact.locationId !== profile.locationId)) throw new GhlError("location")
        const contactName = contact ? text(contact.contactName || contact.name || [contact.firstName, contact.lastName].filter(v => typeof v === "string").join(" "), 200) : "Not provided"
        const contactDetails = contact ? [text(contact.phone, 80, ""), text(contact.email, 254, "")].filter(Boolean).join("; ") || "Not provided" : "Not provided"
        return {
            id, locationId: profile.locationId, calendarId: event.calendarId, calendarName: text(calendar.name, 200),
            contactId, contactName, title: text(event.title, 200), startTime, endTime,
            timezone: timezone(event.timezone ?? calendar.timezone ?? location.timezone ?? profile.timezone),
            status: text(event.appointmentStatus, 60, "unknown").toLowerCase(),
            contactDetails, meetingDetails: text(event.address, 500),
            // Arbitrary contact custom fields are not appointment booking answers.
            bookingDetails: profile.includeNotes ? text(event.notes, 500) : "Booking details are not configured.",
            sourceUpdatedAt: event.dateUpdated == null ? null : timestamp(event.dateUpdated),
            observedAt: new Date().toISOString(), deleted: event.deleted === true,
        }
    })
}

// The documented endpoint has no pagination. A capped or malformed response is
// incomplete, so it must never be used to infer deletions or advance coverage.
export async function fetchCalendarWindow(profile: ProviderProfile, window: { start: string; end: string }, fetcher: typeof fetch = fetch): Promise<{ appointmentIds: string[]; complete: true }> {
    const start = Date.parse(window.start), end = Date.parse(window.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 86_400_000) throw new GhlError("window")
    return withProvider(profile, fetcher, async request => {
        const query = new URLSearchParams({ locationId: profile.locationId, calendarId: profile.calendarId, startTime: String(start), endTime: String(end) })
        const response = await request(`/calendars/events?${query}`, "events")
        const events = response?.events
        if (!Array.isArray(events) || events.length >= 1000 || response?.nextPage || response?.nextPageUrl || (typeof response?.total === "number" && response.total !== events.length)) throw new GhlError("response")
        const ids = new Set<string>()
        for (const raw of events) {
            const event = record(raw)
            if (!isGhlIdentifier(event.id) || event.locationId !== profile.locationId || event.calendarId !== profile.calendarId) throw new GhlError("location")
            // Some feeds include blocked slots. They have no contact; native
            // appointment lookup decides the object type before anything is sent.
            ids.add(event.id)
        }
        return { appointmentIds: [...ids], complete: true }
    })
}
