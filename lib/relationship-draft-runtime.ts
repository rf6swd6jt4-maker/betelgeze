import type { RelationshipDraftQueue } from "./relationship-draft-queue"
type Entry = { queue: RelationshipDraftQueue; users: number; unsubscribe?: () => void }
const entries = new Map<string, Entry>()
let installed = false
export function getRelationshipDraftQueue(key: string, create: () => RelationshipDraftQueue) {
    if (typeof window === "undefined") return create()
    if (!installed) {
        installed = true
        window.addEventListener("betelgeze:offline-account-clearing", () => {
            for (const entry of entries.values()) { entry.unsubscribe?.(); entry.queue.stop() }
            entries.clear()
        })
        const recover = () => {
            if (!navigator.onLine || document.visibilityState !== "visible") return
            for (const entry of entries.values()) if (!entry.queue.getSnapshot().conflict) void entry.queue.flush()
        }
        window.addEventListener("online", recover)
        window.addEventListener("focus", recover)
        document.addEventListener("visibilitychange", recover)
    }
    let entry = entries.get(key)
    if (!entry) { entry = { queue: create(), users: 0 }; entries.set(key, entry) }
    return entry.queue
}
export function retainRelationshipDraftQueue(key: string, queue: RelationshipDraftQueue) {
    let entry = entries.get(key)
    if (!entry) { entry = { queue, users: 0 }; entries.set(key, entry) }
    if (entry.queue !== queue) return () => {}
    entry.users++
    const collect = () => {
        if (entry.users || queue.isDirty() || queue.getSnapshot().saving) return
        entry.unsubscribe?.()
        entries.delete(key)
    }
    entry.unsubscribe ??= queue.subscribe(collect)
    return () => { entry.users--; collect() }
}
