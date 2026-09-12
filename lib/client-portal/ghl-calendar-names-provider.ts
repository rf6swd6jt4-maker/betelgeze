import { GhlError, readGhlJson } from "./ghl-provider"
import type { OwnerCalendarResult } from "./ghl-calendar-provider"
export type ContactLabel = { name: string; city?: string }
export type ContactLabels = Record<string, ContactLabel>
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{10,80}$/.test(value)
const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : ""

// Only contact IDs embedded in validated appointment rows can enter this lookup.
// Opportunity/custom-field data is deliberately ignored, even if only one deal exists.
export async function fetchGhlCalendarNames(credentials: {locationId: string; privateToken: string}, snapshot: OwnerCalendarResult, fetcher: typeof fetch = fetch): Promise<ContactLabels> {
    const ids = [...new Set(snapshot.events.filter(e => e.kind === "appointment").map(e => snapshot.eventContacts?.[e.id]).filter(identifier))]
    if (ids.length > 1000) throw new GhlError("response")
    const labels: ContactLabels = {}, batches = Array.from({length: Math.ceil(ids.length / 100)}, (_, i) => ids.slice(i * 100, (i + 1) * 100))
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000)
    let next = 0
    const worker = async () => {
        while (next < batches.length) {
            const batch = batches[next++], allowed = new Set(batch)
            const response = await fetcher("https://services.leadconnectorhq.com/contacts/search", {
                method: "POST", headers: {Authorization: `Bearer ${credentials.privateToken}`, Version: "v3", "Content-Type": "application/json"},
                body: JSON.stringify({locationId: credentials.locationId, page: 1, pageLimit: batch.length, filters: [{group: "OR", filters: batch.map(id => ({field: "id", operator: "eq", value: id}))}]}),
                cache: "no-store", redirect: "error", signal: controller.signal,
            })
            if (!response.ok) { await response.body?.cancel(); throw new GhlError(response.status === 401 || response.status === 403 ? "permissions" : response.status === 429 ? "rate_limit" : "unavailable") }
            const result = await readGhlJson(response, 524288)
            if (!Array.isArray(result.contacts) || !Number.isSafeInteger(result.total) || result.total !== result.contacts.length || result.contacts.length > batch.length) throw new GhlError("response")
            const seen = new Set<string>()
            for (const contact of result.contacts) {
                if (!contact || !allowed.has(contact.id) || seen.has(contact.id) || contact.locationId !== credentials.locationId) throw new GhlError("location")
                seen.add(contact.id)
                if (contact.deleted === true) continue
                const name = [text(contact.firstName, 80), text(contact.lastName, 80)].filter(Boolean).join(" ") || text(contact.contactName, 160)
                if (!name || name.length > 160) continue
                const city = text(contact.city, 100)
                labels[contact.id] = {name, ...(city ? {city} : {})}
            }
        }
    }
    try { await Promise.all(Array.from({length: Math.min(2, batches.length)}, worker)); return labels }
    catch (error) { controller.abort(); throw error instanceof GhlError ? error : new GhlError("unavailable") }
    finally { clearTimeout(timeout) }
}
