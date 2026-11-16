// Shapes and wording for the Today layout's client rail (docs/today-layout.md, "Client rail").
// The read itself is GET /api/workspaces/<slug>/client-rail: a bounded, name-ordered list of current relationships.

export type RailClient = { id: string; name: string; business: string | null }
export type ClientRail = { clients: RailClient[]; truncated: boolean }

/** The rail shows at most this many clients; the rest stay reachable through Relationships and search. */
export const CLIENT_RAIL_LIMIT = 60

export function parseClientRail(raw: unknown): ClientRail | null {
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as { clients?: unknown }).clients)) return null
    const clients: RailClient[] = []
    for (const entry of (raw as { clients: Array<Record<string, unknown> | null> }).clients) {
        if (!entry || typeof entry.id !== "string" || !entry.id) return null
        const name = typeof entry.name === "string" ? entry.name.trim() : ""
        const business = typeof entry.business === "string" && entry.business.trim() ? entry.business.trim() : null
        clients.push({ id: entry.id, name: name || business || "Unnamed client", business: name ? business : null })
    }
    return { clients: clients.slice(0, CLIENT_RAIL_LIMIT), truncated: (raw as { truncated?: unknown }).truncated === true || clients.length > CLIENT_RAIL_LIMIT }
}

/**
 * Two letters for a client's tile, matching the initials Communications shows for the same person: the first letter
 * of the first and last words, or the first two letters of a single word. Letters and digits only.
 */
export function clientInitials(name: string) {
    const words = name.normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    if (!words.length) return "?"
    const first = [...words[0]]
    const letters = words.length === 1 ? first.slice(0, 2) : [first[0], [...words[words.length - 1]][0]]
    return letters.join("").toLocaleUpperCase()
}

/** Case- and accent-insensitive match on the person's or the business's name. An empty query keeps everyone. */
export function filterRailClients(clients: RailClient[], query: string) {
    const fold = (value: string) => value.normalize("NFD").replace(/\p{M}+/gu, "").toLocaleLowerCase()
    const wanted = fold(query.trim())
    if (!wanted) return clients
    return clients.filter(client => fold(client.name).includes(wanted) || (client.business ? fold(client.business).includes(wanted) : false))
}
