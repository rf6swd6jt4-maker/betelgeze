// One small read per section of a client's page (components/relationships/Client*.tsx), shared by every place that
// shows it and by the tab that warms it on hover. A section reads the first time it is opened or pointed at, keeps its
// answer while the page is open, and reads again only when asked (after a change) or once the answer is a minute old
// and the section is shown again. Requests are deduplicated; nothing polls and nothing runs while a section is closed.

export type SectionState<T> = { data: T | null; error: string | null; loading: boolean }

type Entry<T> = { state: SectionState<T>; at: number; pending: Promise<void> | null; listeners: Set<() => void> }

const RETAINED = 24
const FRESH_MS = 60_000

export function createSectionRead<T>(describe: (response: Response, body: unknown) => string) {
    const entries = new Map<string, Entry<T>>()
    const entry = (key: string) => {
        let found = entries.get(key)
        if (!found) {
            found = { state: { data: null, error: null, loading: false }, at: 0, pending: null, listeners: new Set() }
            entries.set(key, found)
            // Bounded: drop the oldest entry nobody is showing.
            for (const [other, value] of entries) { if (entries.size <= RETAINED) break; if (other !== key && !value.listeners.size && !value.pending) entries.delete(other) }
        }
        return found
    }
    const publish = (target: Entry<T>, next: SectionState<T>) => { target.state = next; target.listeners.forEach(listener => listener()) }
    function read(key: string, url: string, userId: string, force = false) {
        const target = entry(key)
        if (target.pending) return target.pending
        if (!force && target.state.data !== null && Date.now() - target.at < FRESH_MS) return Promise.resolve()
        publish(target, { ...target.state, loading: true })
        target.pending = fetch(url, { cache: "no-store", credentials: "same-origin", redirect: "error", headers: { "x-workspace-user": userId }, signal: AbortSignal.timeout(30_000) })
            .then(async response => {
                const body: unknown = await response.json().catch(() => null)
                if (!response.ok) throw new Error(describe(response, body))
                target.at = Date.now()
                // What was already shown stays shown if a later read fails; a good read replaces it.
                publish(target, { data: body as T, error: null, loading: false })
            })
            .catch(error => { publish(target, { data: target.state.data, error: error instanceof Error && error.name !== "TimeoutError" ? error.message : "This took too long. Try again.", loading: false }) })
            .finally(() => { target.pending = null })
        return target.pending
    }
    return {
        read,
        snapshot: (key: string) => entry(key).state,
        subscribe: (key: string, listener: () => void) => { const target = entry(key); target.listeners.add(listener); return () => { target.listeners.delete(listener) } },
        /** Replace what is shown after a change made here (the change's own response), without another read. */
        set: (key: string, data: T) => { const target = entry(key); target.at = Date.now(); publish(target, { data, error: null, loading: false }) },
    }
}
