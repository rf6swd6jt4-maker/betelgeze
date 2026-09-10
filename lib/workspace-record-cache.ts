export type RecordSnapshot<T> = {
    data: T | null
    loading: boolean
    error: string | null
    updatedAt: number
    revision: number
}

type Entry<T> = {
    snapshot: RecordSnapshot<T>
    listeners: Set<() => void>
    request?: Promise<T>
    generation: number
    controller?: AbortController
}

/** A bounded, account-scoped cache. Pending UI drafts live outside read snapshots. */
export class WorkspaceRecordCache<T> {
    private entries = new Map<string, Entry<T>>()
    private readonly limit: number
    private readonly now: () => number
    constructor(limit = 32, now: () => number = Date.now) { this.limit = limit; this.now = now }

    private entry(key: string): Entry<T> {
        let entry = this.entries.get(key)
        if (!entry) {
            entry = { snapshot: { data: null, loading: false, error: null, updatedAt: 0, revision: 0 }, listeners: new Set(), generation: 0 }
            this.entries.set(key, entry)
        }
        // LRU applies to inactive reads only; never evict a mounted subscriber.
        this.entries.delete(key)
        this.entries.set(key, entry)
        this.trim(key)
        return entry
    }

    private trim(exclude?: string) {
        for (const [key, entry] of this.entries) {
            if (this.entries.size <= this.limit) break
            if (key === exclude || entry.listeners.size || entry.request) continue
            this.entries.delete(key)
        }
    }

    getSnapshot(key: string) { return this.entry(key).snapshot }
    subscribe(key: string, listener: () => void) {
        const entry = this.entry(key)
        entry.listeners.add(listener)
        return () => { entry.listeners.delete(listener); this.trim() }
    }
    private publish(entry: Entry<T>, snapshot: RecordSnapshot<T>) {
        entry.snapshot = snapshot
        for (const listener of entry.listeners) listener()
    }
    seed(key: string, data: T) {
        const entry = this.entry(key)
        if (entry.snapshot.data !== null || entry.request) return
        this.publish(entry, { data, loading: false, error: null, updatedAt: this.now(), revision: entry.generation })
    }
    async load(key: string, read: (signal: AbortSignal) => Promise<T>, options: { force?: boolean; maxAge?: number } = {}): Promise<T> {
        const entry = this.entry(key)
        if (entry.request) return entry.request
        if (!options.force && entry.snapshot.data !== null && this.now() - entry.snapshot.updatedAt < (options.maxAge ?? 30_000)) return entry.snapshot.data
        const generation = entry.generation
        const controller = new AbortController()
        entry.controller = controller
        this.publish(entry, { ...entry.snapshot, loading: true, error: null })
        const request = Promise.resolve().then(() => read(controller.signal)).then((data) => {
            if (entry.generation === generation && !controller.signal.aborted) {
                this.publish(entry, { data, loading: false, error: null, updatedAt: this.now(), revision: entry.generation })
            }
            return data
        }).catch((error: unknown) => {
            if (entry.generation === generation && !controller.signal.aborted) {
                this.publish(entry, { ...entry.snapshot, loading: false, error: error instanceof Error ? error.message : "Could not load this panel" })
            }
            throw error
        }).finally(() => {
            if (entry.request === request) { entry.request = undefined; entry.controller = undefined; this.trim() }
        })
        entry.request = request
        return request
    }
    invalidate(predicate: (key: string) => boolean = () => true) {
        // External-store subscribers synchronously call getSnapshot(), which
        // touches LRU order. Never iterate that live Map while notifying them.
        for (const [key, entry] of [...this.entries]) {
            if (!predicate(key)) continue
            entry.generation += 1
            entry.controller?.abort()
            entry.request = undefined
            this.publish(entry, { ...entry.snapshot, revision: entry.generation, updatedAt: 0, loading: false })
        }
    }
    clear() {
        for (const entry of [...this.entries.values()]) {
            entry.generation += 1
            entry.controller?.abort()
            entry.request = undefined
            this.publish(entry, { data: null, loading: false, error: null, updatedAt: 0, revision: entry.generation })
        }
        // Keep subscriptions alive: mounted consumers must observe the reset.
        for (const [key, entry] of this.entries) if (!entry.listeners.size) this.entries.delete(key)
    }
}
