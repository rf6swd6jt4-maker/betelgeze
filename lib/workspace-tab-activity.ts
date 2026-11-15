// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { WORKSPACE_TAB_FRAME_NAME_PREFIX, WORKSPACE_TAB_FRAME_PARAM, WORKSPACE_TAB_VISIBILITY_EVENT } from "./workspace-tabs.ts"

/** Check the shell's current selection, even before a queued activate message arrives. */
export function workspaceDocumentIsActive(nativeTabId?: string) {
    if (nativeTabId && window.parent === window) return document.body.dataset.workspaceActiveTabId === nativeTabId
    if (window.parent !== window) {
        try {
            const frame = window.frameElement as HTMLIFrameElement | null
            if (!frame) return false
            const id = new URLSearchParams(window.location.search).get(WORKSPACE_TAB_FRAME_PARAM)
                ?? (window.name.startsWith(WORKSPACE_TAB_FRAME_NAME_PREFIX) ? window.name.slice(WORKSPACE_TAB_FRAME_NAME_PREFIX.length) : null)
            if (!id) return false
            const host = window.parent.document.body.dataset
            // Today layout (app-alerts.md, docked chat, 15 November 2026): the one chat docked beside the active
            // destination is in front of the person while the shell shows it. The shell names it only while it is
            // displayed; every other reading condition (focus, newest row visible, not covered) is unchanged.
            if (host.workspaceDockedTabId && host.workspaceDockedTabId === id) return !frame.hidden
            const selected = host.workspaceActiveTabId
            return selected ? selected === id : !frame.hidden && document.body.dataset.workspaceTabActive === "true"
        } catch { return false }
    }
    return document.body.dataset.workspaceTabsHosted !== "true"
}

/** One owner for every activation path: new, restored, closed, history and switched tabs. */
export function publishWorkspaceTabActivity(frames: Map<string, HTMLIFrameElement>, activeId: string) {
    document.body.dataset.workspaceActiveTabId = activeId
    for (const [id, frame] of frames) {
        try {
            const target = frame.contentWindow
            if (!target?.document.body) continue
            target.document.body.dataset.workspaceTabActive = id === activeId ? "true" : "false"
            target.dispatchEvent(new Event(WORKSPACE_TAB_VISIBILITY_EVENT))
        } catch { /* A navigating document will reconcile on its existing load/probe. */ }
    }
}
