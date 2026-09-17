import type { UnreadSummary } from "./unread-summary"

export type UnreadSnapshot = { workspaceId: string; userId: string; rows: UnreadSummary[]; stale: boolean }
const eventName = "betelgeze:unread-summary"
const slot = Symbol.for("betelgeze:unread-summary")
type Host = Window & { [slot]?: UnreadSnapshot }
const host = () => (window.top ?? window) as Host

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
