// @ts-expect-error Node's built-in TypeScript runner requires source extensions.
import { compareReadPositions, type ChatReadUpdate } from "./read-state.ts"

/** Seen positions are intent; only a server acknowledgement is a read cursor.
 * A failed chat never replaces another chat's pending read. No message bodies.
 */
export function createChatReadQueue(options: {
    load: () => ChatReadUpdate[]
    store: (pending: ChatReadUpdate[]) => void
    save: (read: ChatReadUpdate) => Promise<ChatReadUpdate>
    acknowledge: (read: ChatReadUpdate) => void
    error: (message: string | null) => void
}) {
    const pending = new Map<string, ChatReadUpdate>()
    const key = (read: ChatReadUpdate) => `${read.kind}:${read.conversationId}`
    let running: Promise<void> | null = null
    let disposed = false
    try { for (const read of options.load()) pending.set(key(read), read) }
    catch { options.error("Read recovery is unavailable on this device.") }
    function persist() {
        try { options.store([...pending.values()]); return true }
        catch { options.error("Read position is pending; this device could not store it for recovery."); return false }
    }
    function flush(): Promise<void> {
        if (running) return running
        if (disposed) return Promise.resolve()
        running = (async () => {
            // One bounded attempt per position per flush, including a newer
            // position observed while a save was in flight. Failures wait for
            // the existing online/focus/reconciliation recovery path.
            const attempted = new Map<string, ChatReadUpdate>()
            while (!disposed) {
                const read = [...pending.values()].find(value => !attempted.has(key(value)) || compareReadPositions(value, attempted.get(key(value))!) > 0)
                if (!read) break
                const id = key(read)
                attempted.set(id, read)
                try {
                    const confirmed = await options.save(read)
                    if (disposed) break
                    if (confirmed.userId !== read.userId || confirmed.workspaceId !== read.workspaceId
                        || key(confirmed) !== id || compareReadPositions(confirmed, read) < 0) throw new Error("Read position was not acknowledged.")
                    options.acknowledge(confirmed)
                    if (compareReadPositions(pending.get(id)!, confirmed) <= 0) pending.delete(id)
                    const stored = persist()
                    if (!pending.size && stored) options.error(null)
                } catch {
                    if (!disposed) options.error("Read position could not be saved. Retrying when messages reconnect.")
                }
            }
        })().finally(() => { running = null })
        return running
    }
    return {
        observe(read: ChatReadUpdate) {
            if (disposed) return
            const previous = pending.get(key(read))
            if (previous && compareReadPositions(previous, read) >= 0) return
            if (!previous && pending.size >= 256) { options.error("Read recovery is full. Reconnect to save pending reads."); return }
            pending.set(key(read), read)
            persist()
            void flush()
        },
        flush,
        dispose() { disposed = true },
    }
}
