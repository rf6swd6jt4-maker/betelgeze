import type { AppointmentDraftQueue } from "./appointment-draft-queue"
import type { AppointmentSettingAppointment, AppointmentUpdateField } from "./appointment-setting"

type Queue = AppointmentDraftQueue<AppointmentSettingAppointment, AppointmentUpdateField>
type Entry = { queue: Queue; users: number; stopListening?: () => void }
const entries = new Map<string, Entry>()
let accountListenerInstalled = false
let accountChannel: BroadcastChannel | undefined

export function appointmentDraftRuntimeKey(userId: string, workspaceId: string, relationshipId: string, appointmentId: string) {
    return [userId, workspaceId, relationshipId, appointmentId].join(":")
}

export function getAppointmentDraftQueue(key: string, create: () => Queue): Queue {
    // Server rendering must never put user records in a process-global cache.
    if (typeof window === "undefined") return create()
    if (!accountListenerInstalled) {
        if (typeof BroadcastChannel !== "undefined") {
            accountChannel = new BroadcastChannel("betelgeze:appointment-draft-accounts")
            accountChannel.onmessage = (event) => clearAppointmentDraftRuntime(typeof event.data?.preservedUserId === "string" ? event.data.preservedUserId : undefined)
        }
        window.addEventListener("betelgeze:offline-account-clearing", (event) => {
            const preservedUserId = (event as CustomEvent<{ preservedUserId?: string }>).detail?.preservedUserId
            clearAppointmentDraftRuntime(preservedUserId)
            accountChannel?.postMessage({ preservedUserId })
        })
        accountListenerInstalled = true
    }
    let entry = entries.get(key)
    if (!entry) {
        entry = { queue: create(), users: 0 }
        entries.set(key, entry)
    }
    return entry.queue
}

export function retainAppointmentDraftQueue(key: string, queue: Queue) {
    const entry = entries.get(key)
    if (!entry || entry.queue !== queue) return () => {}
    entry.users += 1
    const collect = () => {
        const snapshot = queue.getSnapshot()
        if (entry.users || snapshot.saving || Object.keys(snapshot.changes).length) return
        entry.stopListening?.()
        entries.delete(key)
    }
    entry.stopListening ??= queue.subscribe(collect)
    return () => { entry.users -= 1; collect() }
}

export function clearAppointmentDraftRuntime(preservedUserId?: string | null) {
    for (const [key, entry] of entries) {
        if (preservedUserId && key.startsWith(`${preservedUserId}:`)) continue
        entry.stopListening?.()
        // A request already at the server may finish. Suppress its callbacks,
        // next request, and storage writes after logout/account replacement.
        entry.queue.stop()
        entries.delete(key)
    }
}
