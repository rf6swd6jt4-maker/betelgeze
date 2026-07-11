// Cross-tab plan sync for the relationship Gantt. Any tab that mutates work
// items (the Gantt itself or the work-item editor) posts to a per-workspace
// BroadcastChannel; every open Gantt for that workspace refetches its plan.
// Same-origin only and requires no backend — see RelationshipGantt for the
// listener side.

export const GANTT_SYNC_PREFIX = "betelgeze:gantt-sync:"

export function ganttSyncChannelName(workspaceSlug: string) {
    return `${GANTT_SYNC_PREFIX}${workspaceSlug}`
}

export function postGanttSync(workspaceSlug: string) {
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(ganttSyncChannelName(workspaceSlug))
    channel.postMessage({ at: Date.now() })
    channel.close()
}
