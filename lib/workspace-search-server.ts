/** One search owns its deadline and reads; nothing is cached across requests. */
export const SEARCH_SERVER_TIMEOUT_MS = 25_000
export const SEARCH_READ_CONCURRENCY = 7

export async function withSearchDeadline<T>(source: AbortSignal, work: (signal: AbortSignal) => Promise<T>, timeoutMs = SEARCH_SERVER_TIMEOUT_MS): Promise<T> {
    const controller = new AbortController()
    const relayAbort = () => controller.abort(source.reason)
    const timer = setTimeout(() => controller.abort(new DOMException("Search timed out", "TimeoutError")), timeoutMs)
    let rejectAbort: () => void = () => {}
    const aborted = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(controller.signal.reason)
        controller.signal.addEventListener("abort", rejectAbort, { once: true })
    })
    source.addEventListener("abort", relayAbort, { once: true })
    if (source.aborted) relayAbort()
    try {
        controller.signal.throwIfAborted()
        return await Promise.race([work(controller.signal), aborted])
    } finally {
        clearTimeout(timer)
        source.removeEventListener("abort", relayAbort)
        controller.signal.removeEventListener("abort", rejectAbort)
        controller.abort()
        // A request already aborted before work starts still owns this rejection.
        void aborted.catch(() => {})
    }
}

type SearchQuery<T> = { abortSignal(signal: AbortSignal): PromiseLike<{ data: T | null; error: unknown }> }

/** Same maximum fan-out as the former largest category batch, without its barriers. */
export function createSearchReader(source: AbortSignal) {
    const failed = new AbortController()
    const signal = AbortSignal.any([source, failed.signal])
    let active = 0
    const waiting: Array<{ resolve: () => void; reject: (reason: unknown) => void }> = []
    signal.addEventListener("abort", () => {
        for (const pending of waiting.splice(0)) pending.reject(signal.reason)
    }, { once: true })
    return async function read<T>(query: SearchQuery<T>): Promise<NonNullable<T>> {
        signal.throwIfAborted()
        if (active >= SEARCH_READ_CONCURRENCY) await new Promise<void>((resolve, reject) => waiting.push({ resolve, reject }))
        else active += 1
        try {
            signal.throwIfAborted()
            const { data, error } = await query.abortSignal(signal)
            signal.throwIfAborted()
            if (error || data === null || data === undefined) throw new Error("Search read unavailable")
            return data as NonNullable<T>
        } catch (error) {
            failed.abort(error)
            throw error
        } finally {
            const next = waiting.shift()
            if (next) next.resolve() // Transfer the reserved slot before admitting another read.
            else active -= 1
        }
    }
}
