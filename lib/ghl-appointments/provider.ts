import { GhlError, ghlHttpError, readGhlJson } from "../client-portal/ghl-provider"
import type { AppointmentSnapshot, AppointmentLeadInformation, LeadFieldMapping, ProviderProfile } from "./types"

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

function optionalText(value: unknown, maximum: number): string | null {
    if (typeof value !== "string" || value.length > maximum) return null
    return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() || null
}
function concise(value: string | null, fallback: string): string {
    if (!value) return fallback
    const compact = value.replace(/\s+/g, " ").trim()
    return compact.length <= 500 ? compact : `${compact.slice(0, 473).trimEnd()}… See appointment details.`
}
function meetingUrl(value: string | null): string | null {
    if (!value || value.length > 2048) return null
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2048 ? url.href : null } catch { return null }
}
// Capture only approved contact fields, never arbitrary CRM/private objects.
// Limits keep optional enrichment inside the existing snapshot/request budget.
function contactLeadInformation(contact: Record<string, unknown> | null, mapping: LeadFieldMapping[] | undefined, capturedAt: string): AppointmentLeadInformation {
    const approved = Array.isArray(mapping) && mapping.length <= 8 && mapping.every(item => item && isGhlIdentifier(item.fieldId)
        && typeof item.label === "string" && item.label.length > 0 && item.label.length <= 200 && item.label === item.label.trim()
        && !/[\u0000-\u001f\u007f]/.test(item.label)) && new Set(mapping.map(item => item.fieldId)).size === mapping.length ? mapping : []
    const rawFields = contact?.customFields
    const values = Array.isArray(rawFields) && rawFields.length <= 256 ? rawFields : []
    const scalar = (value: unknown): string | null => typeof value === "string" ? optionalText(value, 1000)
        : typeof value === "boolean" ? value ? "Yes" : "No" : typeof value === "number" && Number.isFinite(value) ? String(value) : null
    const fields: AppointmentLeadInformation["fields"] = []
    for (const field of approved) {
        const matches = values.filter(value => value && typeof value === "object" && !Array.isArray(value) && value.id === field.fieldId)
        if (matches.length !== 1) continue
        const item = matches[0] as Record<string, unknown>
        const raw = Object.hasOwn(item, "value") ? item.value : item.fieldValue
        let value: string | null = null
        if (Array.isArray(raw) && raw.length > 0 && raw.length <= 20) {
            const parts = raw.map(scalar)
            if (parts.every(part => part !== null)) value = optionalText(parts.join(", "), 1000)
        } else value = scalar(raw)
        if (value) fields.push({ fieldId: field.fieldId, label: field.label, value })
    }
    return { source: optionalText(contact?.source, 200), type: optionalText(contact?.type, 60), capturedAt, fields }
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
        // Live v3 returns `appointment`; the published schema still says `event`.
        // Never fall back from a present malformed envelope or accept two identities.
        if (response.appointment !== undefined && response.event !== undefined) throw new GhlError("response")
        const event = record(response.appointment === undefined ? response.event : response.appointment)
        if (event.id !== id || event.locationId !== profile.locationId) throw new GhlError("location")
        if (event.deleted === true) return null
        if (!isGhlIdentifier(event.calendarId)) throw new GhlError("response")
        const startTime = timestamp(event.startTime), endTime = timestamp(event.endTime)
        if (Date.parse(endTime) <= Date.parse(startTime)) throw new GhlError("response")
        if (event.contactId != null && event.contactId !== "" && !isGhlIdentifier(event.contactId)) throw new GhlError("response")
        const contactId = typeof event.contactId === "string" ? event.contactId : ""
        const contactReadStartedAt = new Date().toISOString()
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
        const meeting = optionalText(event.address, 4000)
        // Keep the existing explicitly enabled legacy booking-text allowance.
        // Separate appointment-note bodies can be internal and never enter this
        // client projection merely because the provider supports their retrieval.
        const booking = profile.includeNotes ? optionalText(event.notes, 500) : null
        const sourceUpdatedAt = event.dateUpdated == null ? null : timestamp(event.dateUpdated)
        const sourceCreatedAt = event.dateAdded == null ? null : timestamp(event.dateAdded)
        return {
            id, locationId: profile.locationId, calendarId: event.calendarId, calendarName: text(calendar.name, 200),
            contactId, contactName, title: text(event.title, 200), startTime, endTime,
            timezone: timezone(event.timezone ?? calendar.timezone ?? location.timezone ?? profile.timezone),
            status: text(event.appointmentStatus, 60, "unknown").toLowerCase(),
            contactDetails, meetingDetails: concise(meeting, "Not provided"),
            // Arbitrary contact custom fields are not appointment booking answers.
            bookingDetails: profile.includeNotes ? concise(booking, typeof event.notes === "string" && event.notes.length > 500 ? "Booking text requires an agency review before sharing." : "Not provided") : "Booking details are not configured.",
            sourceUpdatedAt, sourceCreatedAt,
            observedAt: new Date().toISOString(), deleted: event.deleted === true,
            details: {
                schemaVersion: 1,
                contact: { phone: optionalText(contact?.phone, 80), email: optionalText(contact?.email, 254), company: optionalText(contact?.companyName, 200),
                    address: [contact?.address1, contact?.city, contact?.state, contact?.postalCode, contact?.country].map(value => optionalText(value, 250)).filter(Boolean).join(", ") || null },
                meeting: { location: meeting, joinUrl: meetingUrl(meeting) },
                assignedUserId: isGhlIdentifier(event.assignedUserId) ? event.assignedUserId : null,
                source: { createdAt: sourceCreatedAt, updatedAt: sourceUpdatedAt },
                booking: { text: booking, state: !profile.includeNotes ? "not_enabled" : booking ? "available" : typeof event.notes === "string" && event.notes.length > 500 ? "too_large" : "not_provided" },
                lead: contactLeadInformation(contact, profile.leadFieldMapping, contactReadStartedAt),
                formSubmissionState: "unavailable",
            },
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

export type CalendarObservation = { id: string; updatedAt: string | null; startTime: string; endTime: string; status: string; title: string; contactId: string }
// Bounded wide discovery complements the daily/known-ID sweep. A large calendar
// fails visibly and keeps the existing narrow sweep; never infer a deletion here.
export async function fetchCalendarChanges(profile: ProviderProfile, window: { start: string; end: string }, fetcher: typeof fetch = fetch): Promise<CalendarObservation[]> {
    const start = Date.parse(window.start), end = Date.parse(window.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 98 * 86_400_000) throw new GhlError("window")
    return withProvider(profile, fetcher, async request => {
        const query = new URLSearchParams({ locationId: profile.locationId, calendarId: profile.calendarId, startTime: String(start), endTime: String(end) })
        const response = await request(`/calendars/events?${query}`, "events")
        if (!Array.isArray(response?.events) || response.events.length >= 1000 || response.nextPage || response.nextPageUrl || (typeof response.total === "number" && response.total !== response.events.length)) throw new GhlError("response")
        const ids = new Set<string>()
        return response.events.map(raw => {
            const event = record(raw)
            if (!isGhlIdentifier(event.id) || ids.has(event.id) || event.locationId !== profile.locationId || event.calendarId !== profile.calendarId) throw new GhlError("location")
            ids.add(event.id)
            return { id: event.id, updatedAt: event.dateUpdated == null ? null : timestamp(event.dateUpdated), startTime: timestamp(event.startTime), endTime: timestamp(event.endTime), status: text(event.appointmentStatus, 60, "unknown").toLowerCase(), title: text(event.title, 200), contactId: text(event.contactId, 160, "") }
        })
    })
}
