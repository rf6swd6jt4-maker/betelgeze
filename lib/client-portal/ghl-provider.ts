import type { GhlMetrics } from "./ghl-types"

export class GhlError extends Error {
    code: string
    constructor(code: string) { super(code); this.code = code }
}

export function parseGhlCredentials(value: unknown): { locationId: string; privateToken: string } | null {
    if (!value || typeof value !== "object") return null
    const { locationId, privateToken } = value as Record<string, unknown>
    if (typeof locationId !== "string" || typeof privateToken !== "string") return null
    const id = locationId.trim(), token = privateToken.trim()
    if (!/^[a-zA-Z0-9_-]{10,80}$/.test(id) || !/^[\x21-\x7e]{20,4096}$/.test(token)) return null
    return { locationId: id, privateToken: token }
}

// Limit both successful and failing bodies; never log or return provider payloads.
export async function readGhlJson(response: Response, maxBytes = 262_144): Promise<Record<string, unknown>> {
    const reader = response.body?.getReader()
    if (!reader) throw new GhlError("response")
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > maxBytes) throw new GhlError("response")
            chunks.push(value)
        }
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
        if (!value || Array.isArray(value) || typeof value !== "object") throw new GhlError("response")
        return value as Record<string, unknown>
    } catch (error) {
        await reader.cancel().catch(() => {})
        throw error instanceof GhlError ? error : new GhlError("response")
    } finally { reader.releaseLock() }
}

function total(value: Record<string, unknown>, collection: string, locationId: string, status?: string) {
    const rows = value[collection]
    if (!Number.isSafeInteger(value.total) || (value.total as number) < 0 || !Array.isArray(rows) || rows.length > 1) throw new GhlError("response")
    if ((value.total === 0) !== (rows.length === 0)) throw new GhlError("response")
    for (const row of rows) {
        if (!row || typeof row !== "object") throw new GhlError("response")
        if (row.locationId !== undefined && row.locationId !== locationId) throw new GhlError("location")
        if (status && row.status !== status) throw new GhlError("response")
    }
    return value.total as number
}

export async function fetchGhlMetrics(credentials: { locationId: string; privateToken: string }, fetcher: typeof fetch = fetch): Promise<{ locationName: string; metrics: GhlMetrics }> {
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), 20_000)
    const { locationId, privateToken } = credentials
    const request = async (path: string, body?: Record<string, unknown>) => {
        const response = await fetcher(`https://services.leadconnectorhq.com${path}`, {
            method: body ? "POST" : "GET", redirect: "error", cache: "no-store", signal: controller.signal,
            headers: { Authorization: `Bearer ${privateToken}`, Version: "v3", Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
        })
        if (!response.ok) {
            await response.body?.cancel()
            throw new GhlError(response.status === 401 ? "credentials" : response.status === 403 ? "permissions" : response.status === 404 ? "location" : response.status === 429 ? "rate_limit" : "unavailable")
        }
        return readGhlJson(response)
    }
    try {
        // Validate the account before any counts; an arbitrary/ignored location must not look connected.
        const identity = (await request(`/locations/${encodeURIComponent(locationId)}`)).location
        if (!identity || typeof identity !== "object" || (identity as Record<string, unknown>).id !== locationId) throw new GhlError("location")
        const locationName = (identity as Record<string, unknown>).name
        if (typeof locationName !== "string" || !locationName.trim()) throw new GhlError("response")
        const opportunityCount = async (status?: string) => total(await request("/opportunities/search", {
            locationId, query: "", page: 0, limit: 1,
            filters: status ? [{ field: "status", operator: "eq", value: status }] : [],
            additionalDetails: { notes: false, tasks: false, calendarEvents: false, unReadConversations: false },
        }), "opportunities", locationId, status)
        const [contacts, opportunities, open, won, lost] = await Promise.all([
            request("/contacts/search", { locationId, page: 1, pageLimit: 1 }).then((result) => total(result, "contacts", locationId)),
            opportunityCount(), opportunityCount("open"), opportunityCount("won"), opportunityCount("lost"),
        ])
        return { locationName: locationName.trim().slice(0, 200), metrics: { contacts, opportunities, open, won, lost } }
    } catch (error) {
        controller.abort()
        throw error instanceof GhlError ? error : new GhlError("unavailable")
    } finally { clearTimeout(deadline) }
}
