import { GhlError, readGhlJson } from "./ghl-provider"
import { monthWindow, validMonth, type GhlCalendarSnapshot } from "./ghl-calendar"
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{10,80}$/.test(value)
type Credentials = { locationId: string; privateToken: string }
export type OwnerBinding = { companyId: string; timezone: string; owner: { id: string; name: string } }
export type OwnerCalendarResult = GhlCalendarSnapshot & { companyId: string }

// Only GHL's explicit owner designation qualifies. Never infer ownership from an
// admin role, display name, business email, or the first calendar/user returned.
function ownerFromUsers(result: Record<string, unknown>, locationId: string, expectedId?: string) {
    if (!Array.isArray(result.users) || result.users.length > 100 || !Number.isSafeInteger(result.count) || (result.count as number) > result.users.length) throw new GhlError("owner_unavailable")
    const owners = result.users.filter(user => user && user.deleted !== true && user.isAgencyOwner === true && Array.isArray(user.roles?.locationIds) && user.roles.locationIds.includes(locationId))
    if (owners.length !== 1 || !identifier(owners[0].id) || (expectedId && owners[0].id !== expectedId)) throw new GhlError("owner_unavailable")
    const name = owners[0].name || [owners[0].firstName, owners[0].lastName].filter(Boolean).join(" ")
    return { id: owners[0].id as string, name: typeof name === "string" ? name.slice(0, 160) : "Owner" }
}
function validTimezone(timezone: unknown): timezone is string {
    if (typeof timezone !== "string") return false
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); return true } catch { return false }
}
export function parseOwnerBinding(value: unknown): OwnerBinding | null {
    if (!value || typeof value !== "object") return null
    const b = value as OwnerBinding
    return identifier(b.companyId) && validTimezone(b.timezone) && identifier(b.owner?.id) && typeof b.owner.name === "string" ? { companyId: b.companyId, timezone: b.timezone, owner: { id: b.owner.id, name: b.owner.name.slice(0,160) } } : null
}
export async function fetchGhlCalendar(credentials: Credentials, month: string, binding: OwnerBinding | null = null, fetcher: typeof fetch = fetch): Promise<OwnerCalendarResult> {
    if (!validMonth(month)) throw new GhlError("response")
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000)
    const request = async (path: string) => {
        const response = await fetcher(`https://services.leadconnectorhq.com${path}`, { headers: { Authorization: `Bearer ${credentials.privateToken}`, Version: "v3", Accept: "application/json" }, cache: "no-store", redirect: "error", signal: controller.signal })
        if (!response.ok) { await response.body?.cancel(); throw new GhlError(response.status === 401 || response.status === 403 ? "permissions" : response.status === 429 ? "rate_limit" : "unavailable") }
        return readGhlJson(response, 524288)
    }
    const users = (companyId: string, id?: string) => request(`/users/search?${new URLSearchParams({ companyId, locationId: credentials.locationId, limit: id ? "2" : "100", ...(id ? { ids: id } : {}) })}`)
    try {
        // Resolve the owner once when establishing the connection's calendar.
        // Later refreshes verify this owner alongside the two schedule reads.
        let ownerCheck: Promise<{ id: string; name: string }>
        if (!binding) {
            const identity = await request(`/locations/${encodeURIComponent(credentials.locationId)}`)
            const location = identity.location as Record<string, unknown> | undefined
            if (location?.id !== credentials.locationId || !identifier(location.companyId)) throw new GhlError("location")
            if (!validTimezone(location.timezone)) throw new GhlError("response")
            const owner = ownerFromUsers(await users(location.companyId), credentials.locationId)
            binding = { companyId: location.companyId, timezone: location.timezone, owner }
            ownerCheck = Promise.resolve(owner)
        } else {
            ownerCheck = users(binding.companyId, binding.owner.id).then(value => ownerFromUsers(value, credentials.locationId, binding!.owner.id))
        }
        const { timezone, companyId } = binding
        const window = monthWindow(month, timezone)
        const query = new URLSearchParams({ locationId: credentials.locationId, userId: binding.owner.id, startTime: String(window.start), endTime: String(window.end - 1) })
        const [owner, appointments, blocks] = await Promise.all([ownerCheck, request(`/calendars/events?${query}`), request(`/calendars/blocked-slots?${query}`)])
        if (!Array.isArray(appointments.events) || !Array.isArray(blocks.events) || appointments.events.length + blocks.events.length > 1000) throw new GhlError("response")
        const snapshot: OwnerCalendarResult = { source: "owner-user", companyId, owner, timezone, month, events: [] }
        const seen = new Set<string>(), midnight = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
        for (const [rows, kind] of [[appointments.events, "appointment"], [blocks.events, "busy"]] as const) {
            for (const row of rows) {
                if (typeof row.id !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(row.id) || row.assignedUserId !== owner.id || row.locationId !== credentials.locationId) throw new GhlError("location")
                if (typeof row.startTime !== "string" || typeof row.endTime !== "string" || !/(Z|[+-]\d{2}:?\d{2})$/.test(row.startTime) || !/(Z|[+-]\d{2}:?\d{2})$/.test(row.endTime)) throw new GhlError("response")
                const start = Date.parse(row.startTime), end = Date.parse(row.endTime)
                if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new GhlError("response")
                if (end <= window.start || start >= window.end || seen.has(row.id) || row.deleted === true) continue
                seen.add(row.id)
                const status = typeof row.appointmentStatus === "string" ? row.appointmentStatus.toLowerCase() : kind === "busy" ? "busy" : "confirmed"
                if (["deleted", "invalid"].includes(status)) continue
                snapshot.events.push({ id: row.id, kind, title: kind === "busy" ? "Busy" : typeof row.title === "string" && row.title.trim() ? row.title.trim().slice(0,200) : "Appointment", start: new Date(start).toISOString(), end: new Date(end).toISOString(), status, allDay: midnight.format(start) === "00:00:00" && midnight.format(end) === "00:00:00" })
            }
        }
        snapshot.events.sort((a,b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
        return snapshot
    } catch (error) { controller.abort(); throw error instanceof GhlError ? error : new GhlError("unavailable") } finally { clearTimeout(timeout) }
}
