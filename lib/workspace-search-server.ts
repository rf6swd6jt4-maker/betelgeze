/** One search owns its deadline and reads; nothing is cached across requests. */
export const SEARCH_SERVER_TIMEOUT_MS = 25_000

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
