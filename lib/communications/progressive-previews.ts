/** One bounded preview lane. Histories keep their independent selected-chat lane. */
export function createProgressivePreviewQueue<T extends { conversationId: string }>(options: {
    initialReady?: Iterable<string>
    request: (ids: string[], signal: AbortSignal) => Promise<T[]>
    apply: (items: T[]) => void
    failed: (ids: string[]) => void
}) {
    const confirmed = new Set(options.initialReady)
    const failed = new Set<string>()
    let visible = new Set<string>()
    let generation = 0
    let active = false
    let disposed = false
    let inFlight: AbortController | null = null

    async function pump() {
        if (!active || disposed || inFlight) return
        const ids = [...visible].filter(id => !confirmed.has(id) && !failed.has(id)).slice(0, 20)
        if (!ids.length) return
        const controller = new AbortController()
        inFlight = controller
        const startedGeneration = generation
        try {
            const items = await options.request(ids, controller.signal)
            if (disposed || controller.signal.aborted || startedGeneration !== generation) return
            const accepted = items.filter(item => ids.includes(item.conversationId) && !confirmed.has(item.conversationId))
            const returned = new Set(accepted.map(item => item.conversationId))
            // Admission changes synchronously, before React can render or release the slot.
            for (const id of returned) { confirmed.add(id); failed.delete(id) }
            const missing = ids.filter(id => !returned.has(id) && !confirmed.has(id))
            for (const id of missing) failed.add(id)
            if (accepted.length) options.apply(accepted)
            if (missing.length) options.failed(missing)
        } catch {
            if (disposed || controller.signal.aborted || startedGeneration !== generation) return
            const missing = ids.filter(id => !confirmed.has(id))
            for (const id of missing) failed.add(id)
            if (missing.length) options.failed(missing)
        } finally {
            if (inFlight === controller) inFlight = null
            if (!disposed) void pump()
        }
    }
    return {
        setVisible(ids: Iterable<string>) { visible = new Set(ids); void pump() },
        setActive(value: boolean) { active = value; if (!value) inFlight?.abort(); else void pump() },
        confirm(ids: Iterable<string>) { for (const id of ids) { confirmed.add(id); failed.delete(id) } },
        invalidate(ids?: Iterable<string>) {
            generation++
            if (ids) for (const id of ids) { confirmed.delete(id); failed.delete(id) }
            else { confirmed.clear(); failed.clear() }
            // An old response must never consume a newer refresh request.
            void pump()
        },
        retry(id: string) { failed.delete(id); confirmed.delete(id); void pump() },
        dispose() { disposed = true; inFlight?.abort(); visible.clear() },
    }
}

/** Missing cursor metadata is unknown; only explicit null confirms no frontier. */
export function confirmedPreviewCursor(value: unknown): value is { lastReadAt: string; lastReadMessageId: string | null } | null {
    if (value === null) return true
    if (!value || typeof value !== "object") return false
    const cursor = value as Record<string, unknown>
    return typeof cursor.lastReadAt === "string" && cursor.lastReadAt.length <= 40 && Number.isFinite(Date.parse(cursor.lastReadAt))
        && (cursor.lastReadMessageId === null || (typeof cursor.lastReadMessageId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.lastReadMessageId)))
}
