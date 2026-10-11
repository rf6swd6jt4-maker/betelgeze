// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { compareReadPositions, normalizeChatReadUpdate, readCursorCoversMessage, type ChatReadUpdate } from "./read-state.ts"

export type UnreadSummary = { kind: "client" | "native"; conversationId: string; count: number; latestMessageId: string; latestMessageAt: string }

const readKey = (read: Pick<ChatReadUpdate, "kind" | "conversationId">) => `${read.kind}:${read.conversationId}`
// Historical null IDs include all timestamp ties, matching the SQL fallback.
const compareConfirmedReads = (left: ChatReadUpdate, right: ChatReadUpdate) => compareReadPositions(
    { ...left, lastReadMessageId: left.lastReadMessageId ?? "\uffff" },
    { ...right, lastReadMessageId: right.lastReadMessageId ?? "\uffff" },
)

export function applyReadsToSummary(rows: UnreadSummary[], reads: readonly ChatReadUpdate[]) {
    const positions = new Map<string, ChatReadUpdate>()
    for (const read of reads) {
        const previous = positions.get(readKey(read))
        if (!previous || compareConfirmedReads(read, previous) > 0) positions.set(readKey(read), read)
    }
    return filterConfirmedReads(rows, positions)
}

function filterConfirmedReads(rows: UnreadSummary[], positions: ReadonlyMap<string, ChatReadUpdate>) {
    return rows.filter(row => {
        const read = positions.get(readKey(row))
        return !read || !readCursorCoversMessage(read, { id: row.latestMessageId, createdAt: row.latestMessageAt })
    })
}

export function applyReadToSummary(rows: UnreadSummary[], read: ChatReadUpdate) {
    return applyReadsToSummary(rows, [read])
}

/** Mounted-owner metadata only. Eviction forgets deduplication, never invents a read. */
export function createConfirmedReadLedger(workspaceId: string, userId: string, limit = 1024) {
    const positions = new Map<string, ChatReadUpdate>()
    const capacity = Math.max(1, Math.min(1024, Math.floor(limit) || 1))
    return {
        accept(reads: readonly ChatReadUpdate[]) {
            const accepted = new Map<string, ChatReadUpdate>()
            for (const candidate of reads) {
                const read = normalizeChatReadUpdate({ workspaceId, userId, kind: candidate.kind }, candidate)
                if (!read) continue
                const key = readKey(read)
                const previous = accepted.get(key) ?? positions.get(key)
                if (previous && compareConfirmedReads(read, previous) <= 0) continue
                accepted.set(key, read)
                positions.delete(key)
                positions.set(key, read)
                if (positions.size > capacity) positions.delete(positions.keys().next().value!)
            }
            return [...accepted.values()]
        },
        apply(rows: UnreadSummary[]) { return filterConfirmedReads(rows, positions) },
        clear() { positions.clear() },
    }
}

/** One request at a time; a response started before a read/message event is stale. */
export function createUnreadSummaryResource<T = UnreadSummary[]>(load: () => Promise<T>, receive: (rows: T) => void, failed: (error: unknown) => void) {
    let revision = 0, disposed = false, pending: Promise<void> | null = null
    let completedRevision = -1
    function refresh(): Promise<void> {
        if (disposed) return Promise.resolve()
        if (pending) return pending
        pending = (async () => {
            let requested: number
            do {
                requested = revision
                try {
                    const rows = await load()
                    if (!disposed && requested === revision) receive(rows)
                } catch (error) {
                    if (disposed) return
                    if (requested === revision) { completedRevision = requested; failed(error); return }
                    // A newer event still needs its one coalesced refresh,
                    // even if the superseded request failed.
                }
                completedRevision = requested
            } while (!disposed && requested !== revision)
        })().finally(() => {
            pending = null
            // An invalidation can arrive after the loop finishes, while
            // its promise is still settling. Do not lose that refresh.
            if (!disposed && completedRevision !== revision) return refresh()
        })
        return pending
    }
    return {
        invalidate() { revision++ },
        refresh,
        dispose() { disposed = true },
    }
}
