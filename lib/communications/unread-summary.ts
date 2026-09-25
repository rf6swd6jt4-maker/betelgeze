// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { compareReadPositions, type ChatReadUpdate } from "./read-state.ts"

export type UnreadSummary = { kind: "client" | "native"; conversationId: string; count: number; latestMessageId: string; latestMessageAt: string }

export function applyReadToSummary(rows: UnreadSummary[], read: ChatReadUpdate) {
    return rows.filter(row => row.kind !== read.kind || row.conversationId !== read.conversationId
        || compareReadPositions({ lastReadAt: row.latestMessageAt, lastReadMessageId: row.latestMessageId }, read) > 0)
}

/** One request at a time; a response started before a read/message event is stale. */
export function createUnreadSummaryResource(load: () => Promise<UnreadSummary[]>, receive: (rows: UnreadSummary[]) => void, failed: () => void) {
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
                } catch {
                    if (disposed) return
                    if (requested === revision) { completedRevision = requested; failed(); return }
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
