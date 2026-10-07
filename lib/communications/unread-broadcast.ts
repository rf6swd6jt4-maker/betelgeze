import { recordVersionKey } from "../record-version.js"
import type { UnreadSummary } from "./unread-summary"

export type UnreadSnapshot = { workspaceId: string; userId: string; rows: UnreadSummary[]; stale: boolean }
const eventName = "betelgeze:unread-summary"
const invalidationEventName = "betelgeze:unread-summary-invalidated"
const slot = Symbol.for("betelgeze:unread-summary")
type Host = Window & { [slot]?: UnreadSnapshot }
const host = () => (window.top ?? window) as Host

/** One committed database event has the same identity on shell/frame sockets.
 * Incomplete event metadata deliberately falls back to ordinary invalidation.
 */
export function unreadMessageEventKey(kind: "client" | "native", value: unknown): string | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    const payload = value as Record<string, unknown>
    const eventType = payload.eventType
    const committedAt = payload.commit_timestamp
    if (typeof eventType !== "string" || !["INSERT", "UPDATE", "DELETE"].includes(eventType)
        || typeof committedAt !== "string" || committedAt.length > 64 || !Number.isFinite(Date.parse(committedAt))) return undefined
    const valueRow = eventType === "DELETE" ? payload.old : payload.new
    if (!valueRow || typeof valueRow !== "object" || Array.isArray(valueRow)) return undefined
    const id = (valueRow as Record<string, unknown>).id
    if (typeof id !== "string" || !id || id.length > 128) return undefined
    return `${kind}:${eventType}:${id}:${recordVersionKey(committedAt)}`
}

/** Ask the existing owner to reconcile an event or accepted recovery snapshot. */
export function invalidateUnreadSummary(workspaceId: string, userId: string, eventKey?: string) {
    host().dispatchEvent(new CustomEvent(invalidationEventName, { detail: { workspaceId, userId, eventKey } }))
}

export function subscribeUnreadSummaryInvalidations(workspaceId: string, userId: string, invalidate: (eventKey?: string) => void) {
    const listener = (event: Event) => {
        const scope = (event as CustomEvent<{ workspaceId: string; userId: string; eventKey?: unknown }>).detail
        if (scope?.workspaceId !== workspaceId || scope.userId !== userId) return
        const eventKey = typeof scope.eventKey === "string" && scope.eventKey.length > 0 && scope.eventKey.length <= 256 ? scope.eventKey : undefined
        invalidate(eventKey)
    }
    const target = host()
    target.addEventListener(invalidationEventName, listener)
    return () => target.removeEventListener(invalidationEventName, listener)
}

/** Reuse the shell's metadata read across resident frames; no extra socket,
 * polling, history request or storage. Scope is checked by every consumer.
 */
export function publishUnreadSummary(snapshot: UnreadSnapshot) {
    host()[slot] = snapshot
    host().dispatchEvent(new CustomEvent(eventName, { detail: snapshot }))
}

export function subscribeUnreadSummary(workspaceId: string, userId: string, receive: (snapshot: UnreadSnapshot) => void) {
    const accept = (snapshot: UnreadSnapshot | undefined) => {
        if (snapshot?.workspaceId === workspaceId && snapshot.userId === userId) receive(snapshot)
    }
    const listener = (event: Event) => accept((event as CustomEvent<UnreadSnapshot>).detail)
    host().addEventListener(eventName, listener)
    accept(host()[slot])
    return () => host().removeEventListener(eventName, listener)
}
