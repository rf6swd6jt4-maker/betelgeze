import type { WorkspaceSearchResult } from "./workspace-search"

export type WorkspaceSearchCandidate = { result: WorkspaceSearchResult; rank: number }
type SearchText = string | null | undefined

// Keep this scale aligned with the search RPC: 4 is a permitted related record,
// while 5 is a secondary-text match such as a person mentioned in another note.
export function rankWorkspaceSearchMatch(query: string, fields: {
    ids?: readonly string[]
    primary: readonly SearchText[]
    secondary?: readonly SearchText[]
}): number {
    const needle = query.trim().toLowerCase()
    if (!needle) return Infinity
    const normalized = (values: readonly SearchText[]) => values.flatMap(value => typeof value === "string" && value ? [value.toLowerCase()] : [])
    const ids = normalized(fields.ids ?? [])
    const primary = normalized(fields.primary)
    if (ids.includes(needle)) return 0
    if (primary.includes(needle)) return 1
    if (primary.some(value => value.startsWith(needle))) return 2
    if (primary.some(value => value.includes(needle))) return 3
    return [...ids, ...normalized(fields.secondary ?? [])].some(value => value.includes(needle)) ? 5 : Infinity
}

export function rankWorkspaceSearchResults(candidates: readonly WorkspaceSearchCandidate[], limit = 20): WorkspaceSearchResult[] {
    const maximum = Number.isFinite(limit) ? Math.max(0, Math.min(20, Math.floor(limit))) : 20
    const ranked = candidates.filter(candidate => Number.isFinite(candidate.rank)).sort((left, right) =>
        Number(left.result.archived === true) - Number(right.result.archived === true)
        || left.rank - right.rank
        || left.result.label.toLowerCase().localeCompare(right.result.label.toLowerCase())
        || left.result.id.localeCompare(right.result.id)
        || left.result.href.localeCompare(right.result.href))
    const ids = new Set<string>(), hrefs = new Set<string>(), results: WorkspaceSearchResult[] = []
    for (const { result } of ranked) {
        if (results.length >= maximum) break
        // Canonical aliases share an ID or destination. Names are never identities.
        if (ids.has(result.id) || hrefs.has(result.href)) continue
        ids.add(result.id)
        hrefs.add(result.href)
        results.push(result)
    }
    return results
}
