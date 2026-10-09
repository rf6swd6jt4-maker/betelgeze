import { GhlError, readGhlJson } from "./ghl-provider"

export type GhlCalendarChoice = { id: string; name: string }
export async function fetchGhlCalendars(credentials: { locationId: string; privateToken: string }, fetcher: typeof fetch = fetch): Promise<GhlCalendarChoice[]> {
    const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 20_000)
    try {
        const response = await fetcher(`https://services.leadconnectorhq.com/calendars/?${new URLSearchParams({ locationId: credentials.locationId, showDrafted: "false" })}`, {
            headers: { Authorization: `Bearer ${credentials.privateToken}`, Version: "v3", Accept: "application/json" },
            redirect: "error", cache: "no-store", signal: controller.signal,
        })
        if (!response.ok) {
            await response.body?.cancel()
            throw new GhlError([401, 403].includes(response.status) ? "permissions" : response.status === 429 ? "rate_limit" : "unavailable")
        }
        const body = await readGhlJson(response, 524288)
        if (!Array.isArray(body.calendars) || body.calendars.length > 200) throw new GhlError("response")
        const seen = new Set<string>()
        return body.calendars.map((row): GhlCalendarChoice => {
            if (!row || typeof row.id !== "string" || !/^[a-zA-Z0-9_-]{10,80}$/.test(row.id) || row.locationId !== credentials.locationId || typeof row.name !== "string" || !row.name.trim() || seen.has(row.id)) throw new GhlError("response")
            seen.add(row.id)
            return { id: row.id, name: row.name.trim().slice(0, 200) }
        }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    } catch (error) { throw error instanceof GhlError ? error : new GhlError("unavailable") }
    finally { clearTimeout(deadline) }
}
