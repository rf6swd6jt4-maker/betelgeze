import { GhlError, ghlHttpError, readGhlJson } from "../client-portal/ghl-provider"
import { isGhlIdentifier } from "./provider"
import type { ProviderProfile } from "./types"

export const APPOINTMENT_NOTE_PAGE_SIZE = 5
export type AppointmentNote = { id: string; body: string; userId: string | null; createdAt: string | null; updatedAt: string | null }
export type AppointmentNotePage = { notes: AppointmentNote[]; hasMore: boolean; nextOffset: number }
type Rpc = (params: { p_action: string; p_input: Record<string, unknown> }) => PromiseLike<{ data: unknown; error: unknown }>

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new GhlError("response")
    return value as Record<string, unknown>
}
function optionalDate(value: unknown) {
    if (value == null) return null
    if (typeof value !== "string" || value.length > 64 || !/(Z|[+-]\d\d:\d\d)$/i.test(value) || !Number.isFinite(Date.parse(value))) throw new GhlError("response")
    return new Date(value).toISOString()
}

/** Staff-only retention. Internal CRM notes never enter a portal or WhatsApp
 * projection. Publishing any body requires a separate visibility review.
 * Optional worker lane only: five notes/page, 8s, <=1.5MiB response. */
export async function fetchAppointmentNotePage(profile: ProviderProfile, appointmentId: string, offset: number, fetcher: typeof fetch = fetch): Promise<AppointmentNotePage> {
    if (!profile.includeNotes || !isGhlIdentifier(profile.locationId) || !isGhlIdentifier(appointmentId) || !/^[\x21-\x7e]{20,4096}$/.test(profile.privateToken)
        || !Number.isSafeInteger(offset) || offset < 0 || offset >= 1000 || offset % APPOINTMENT_NOTE_PAGE_SIZE !== 0) throw new GhlError("response")
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000)
    const request = async (path: string) => {
        const response = await fetcher(`https://services.leadconnectorhq.com${path}`, { cache: "no-store", redirect: "error", signal: controller.signal,
            headers: { Authorization: `Bearer ${profile.privateToken}`, Version: "v3", Accept: "application/json" } })
        if (!response.ok) { await response.body?.cancel(); throw ghlHttpError(response.status, "events", "calendar") }
        return readGhlJson(response, 1_572_864)
    }
    try {
        const location = object((await request(`/locations/${encodeURIComponent(profile.locationId)}`)).location)
        if (location.id !== profile.locationId) throw new GhlError("location")
        const response = await request(`/calendars/appointments/${encodeURIComponent(appointmentId)}/notes?limit=${APPOINTMENT_NOTE_PAGE_SIZE}&offset=${offset}`)
        if (!Array.isArray(response.notes) || response.notes.length > APPOINTMENT_NOTE_PAGE_SIZE || typeof response.hasMore !== "boolean" || (response.hasMore && response.notes.length !== APPOINTMENT_NOTE_PAGE_SIZE)) throw new GhlError("response")
        const ids = new Set<string>()
        const notes = response.notes.map(raw => {
            const note = object(raw)
            if (!isGhlIdentifier(note.id) || ids.has(note.id) || typeof note.body !== "string" || note.body.length > 65000
                || (note.appointmentId !== undefined && note.appointmentId !== appointmentId)
                || (note.locationId !== undefined && note.locationId !== profile.locationId)
                || (note.userId != null && !isGhlIdentifier(note.userId))) throw new GhlError("response")
            ids.add(note.id)
            return { id: note.id, body: note.body.replace(/\u0000/g, ""), userId: typeof note.userId === "string" ? note.userId : null,
                createdAt: optionalDate(note.dateAdded ?? note.createdAt), updatedAt: optionalDate(note.dateUpdated ?? note.updatedAt) }
        })
        return { notes, hasMore: response.hasMore, nextOffset: offset + notes.length }
    } catch (error) { throw error instanceof GhlError ? error : new GhlError("unavailable") }
    finally { clearTimeout(timer) }
}

/** One durable page after primary event/notification work. Failure never changes
 * appointment versions, sends or previously retained staff-only notes. */
export async function processAppointmentNoteEnrichment({ rpc, fetchNotes = fetchAppointmentNotePage }: { rpc: Rpc; fetchNotes?: typeof fetchAppointmentNotePage }): Promise<"idle" | "applied" | "attention"> {
    const call = async (action: string, input: Record<string, unknown> = {}) => {
        const { data, error } = await rpc({ p_action: action, p_input: input })
        if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new Error("Note storage unavailable")
        const result = data as Record<string, unknown>
        if (result.failure) throw new Error("Note storage rejected")
        return result
    }
    const claimed = await call("claim")
    if (!claimed.job) return "idle"
    const job = object(claimed.job)
    const identity = { profileId: job.profileId, appointmentId: job.appointmentId, leaseToken: job.leaseToken, connectionRevision: job.connectionRevision }
    try {
        const page = await fetchNotes(job.profile as ProviderProfile, String(job.appointmentId), Number(job.offset))
        const result = await call("finish", { ...identity, ...page })
        return result.applied === true ? "applied" : "attention"
    } catch (error) {
        const code = error instanceof GhlError ? error.code : "unavailable"
        await call("fail", { ...identity, error: ["permissions", "credentials", "location", "response", "rate_limit"].includes(code) ? code : "unavailable" }).catch(() => {})
        return "attention"
    }
}
