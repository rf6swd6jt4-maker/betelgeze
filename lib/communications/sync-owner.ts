export const COMMUNICATIONS_SYNC_TIMEOUT_MS = 30_000

/** One cancellable recovery read per mounted account/workspace owner. The
 * deadline includes response bodies and releases the slot even if a transport
 * ignores cancellation. Callers must recheck the signal before applying data.
 */
export function createCommunicationsSyncOwner(
    synchronize: (signal: AbortSignal) => Promise<void>,
    timeoutMs = COMMUNICATIONS_SYNC_TIMEOUT_MS,
) {
    let disposed = false
    let pending: { controller: AbortController; promise: Promise<void> } | null = null

    function run(): Promise<void> {
        if (disposed) return Promise.reject(new DOMException("Communications owner departed.", "AbortError"))
        if (pending) return pending.promise
        const controller = new AbortController()
        const { signal } = controller
        let rejectAborted!: (reason: unknown) => void
        const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject })
        const onAbort = () => rejectAborted(signal.reason)
        signal.addEventListener("abort", onAbort, { once: true })
        const timer = setTimeout(() => controller.abort(new DOMException("Checking for missed messages timed out.", "TimeoutError")), timeoutMs)
        const operation = Promise.resolve().then(() => {
            signal.throwIfAborted()
            return synchronize(signal)
        }).then(() => { signal.throwIfAborted() })
        const promise = Promise.race([operation, aborted]).finally(() => {
            clearTimeout(timer)
            signal.removeEventListener("abort", onAbort)
            if (pending?.controller === controller) pending = null
        })
        pending = { controller, promise }
        return promise
    }

    return {
        run,
        dispose() {
            disposed = true
            pending?.controller.abort(new DOMException("Communications owner departed.", "AbortError"))
        },
    }
}
