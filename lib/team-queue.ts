// Shapes for the Today column's Team queue. The read itself is read_team_work_queue (owners and admins only).
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { rankQueue, type QueueItem, type RankedQueueItem } from "./work-queue/ranking.ts"

export type TeamQueuePerson = { userId: string; name: string; ready: number; items: QueueItem[] }
export type TeamQueue = { people: TeamQueuePerson[]; truncated: boolean }
export type TeamQueueRow = RankedQueueItem & { owner: string; ownerId: string }

export function parseTeamQueue(raw: unknown): TeamQueue | null {
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as { people?: unknown }).people)) return null
    const people: TeamQueuePerson[] = []
    for (const entry of (raw as { people: Array<Record<string, unknown>> }).people) {
        if (!entry || typeof entry.userId !== "string" || !Array.isArray(entry.items)) return null
        const items = (entry.items as Array<Record<string, unknown>>).filter(item => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.created_at === "string")
        people.push({ userId: entry.userId, name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : "Team member", ready: Number(entry.ready ?? 0) || 0, items: items as unknown as QueueItem[] })
    }
    return { people, truncated: (raw as { truncated?: unknown }).truncated === true }
}

/**
 * One list across the team. Each person's own order is kept (it is their queue's order); people take turns so nobody's
 * work buries everyone else's, and work already in progress comes first. A shared-service item appears once, under the
 * person who started it when their rows include it, otherwise under the first person it was listed for.
 */
export function teamQueueRows(queue: TeamQueue, limit: number, now = Date.now()): TeamQueueRow[] {
    const perPerson = queue.people.map(person => rankQueue(person.items, now).filter(item => item.state === "Ready" || item.state === "In progress").map(item => ({ ...item, owner: person.name, ownerId: person.userId })))
    // Who lists each item, so a shared item can be shown under its starter only when the starter's rows include it.
    const listedBy = new Map<string, Set<string>>()
    for (const rows of perPerson) for (const row of rows) listedBy.set(row.id, (listedBy.get(row.id) ?? new Set()).add(row.ownerId))
    const seen = new Set<string>()
    const merged: TeamQueueRow[] = []
    for (let position = 0; merged.length < limit * 2 && perPerson.some(rows => position < rows.length); position++) {
        for (const rows of perPerson) {
            const row = rows[position]
            if (!row || seen.has(row.id)) continue
            const starter = row.state === "In progress" ? row.started_by : null
            if (starter && starter !== row.ownerId && listedBy.get(row.id)?.has(starter)) continue
            seen.add(row.id)
            merged.push(starter && starter !== row.ownerId && row.started_by_name ? { ...row, owner: row.started_by_name } : row)
        }
    }
    const inProgress = merged.filter(row => row.state === "In progress")
    return [...inProgress, ...merged.filter(row => row.state !== "In progress")].slice(0, limit)
}
