/** A frame's navigation receiver outlives page loading/error boundaries. */
export const WORKSPACE_FRAME_NAVIGATION_EVENT = "betelgeze:frame-navigate"
export const WORKSPACE_FRAME_NAVIGATION_ATTRIBUTE = "data-workspace-frame-navigation"

export class WorkspaceFrameDraftError extends Error {
    constructor() { super("Your changes are not safely saved yet. Please retry saving."); this.name = "WorkspaceFrameDraftError" }
}

export function createWorkspaceFrameNavigator(options: {
    currentUrl: () => string
    flush: () => Promise<unknown>
    push: (url: string) => void
    replace: (url: string) => void
}) {
    let sequence = 0
    let pending: string | null = null
    return {
        async navigate(url: string, replace = false) {
            if (pending === url || (pending === null && options.currentUrl() === url)) return
            const ownSequence = ++sequence
            pending = url
            try {
                const safe = await options.flush()
                if (sequence !== ownSequence) return
                if (safe === false) throw new WorkspaceFrameDraftError()
                // A -> B (pending) -> A must still reach the router so that it
                // cancels B, even though the committed address is already A.
                if (replace) options.replace(url)
                else options.push(url)
            } catch (error) {
                if (sequence !== ownSequence) return
                pending = null
                throw error
            }
        },
        committed(url: string) { if (pending === url) pending = null },
        dispose() { ++sequence; pending = null },
    }
}

export function workspaceFrameHasNavigationReceiver(frame: { contentDocument: Document | null }, tabId: string) {
    try { return frame.contentDocument?.documentElement.getAttribute(WORKSPACE_FRAME_NAVIGATION_ATTRIBUTE) === tabId }
    catch { return false }
}
