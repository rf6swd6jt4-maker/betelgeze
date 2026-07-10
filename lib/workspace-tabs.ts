export const WORKSPACE_TAB_FRAME_PARAM = "__betelgeze_tab"
export const WORKSPACE_TAB_FRAME_NAME_PREFIX = "betelgeze-tab:"
export const WORKSPACE_TAB_MESSAGE_SOURCE = "betelgeze-workspace-tabs"

export type WorkspaceTabParentMessage = {
    source: typeof WORKSPACE_TAB_MESSAGE_SOURCE
    target: "frame"
    tabId: string
    type: "activate" | "navigate" | "traverse"
    url?: string
    refresh?: boolean
    active?: boolean
}

export type WorkspaceTabFrameMessage = {
    source: typeof WORKSPACE_TAB_MESSAGE_SOURCE
    target: "host"
    tabId: string
    type: "location" | "mutation"
    url?: string
}

export function normalizeWorkspaceUrl(value: string, workspaceSlug: string, origin: string) {
    const parsed = new URL(value, origin)
    parsed.searchParams.delete(WORKSPACE_TAB_FRAME_PARAM)
    const search = parsed.search
    const hash = parsed.hash
    const path = parsed.pathname
    const defaultWorkspaceUrl = `/${workspaceSlug}`
    const dashboardMatch = path.match(new RegExp(`^/dashboard/${workspaceSlug}(?:/(.*))?$`, "i"))
    const leadgenMatch = path.match(new RegExp(`^/leadgen/${workspaceSlug}(?:/(.*))?$`, "i"))

    if (dashboardMatch) return `${defaultWorkspaceUrl}${dashboardMatch[1] ? `/${dashboardMatch[1]}` : ""}${search}${hash}`
    if (leadgenMatch) return `${defaultWorkspaceUrl}/leadgen${leadgenMatch[1] ? `/${leadgenMatch[1]}` : ""}${search}${hash}`
    return `${path}${search}${hash}`
}

export function workspaceTabFrameUrl(value: string, tabId: string, origin: string) {
    const parsed = new URL(value, origin)
    parsed.searchParams.set(WORKSPACE_TAB_FRAME_PARAM, tabId)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function workspaceTabHistoryStep(history: string[], historyIndex: number, step: -1 | 1) {
    const nextIndex = historyIndex + step
    if (nextIndex < 0 || nextIndex >= history.length) return null
    return { historyIndex: nextIndex, url: history[nextIndex] }
}

export function appendWorkspaceTabHistory(history: string[], historyIndex: number, url: string, limit = 50) {
    const nextHistory = [...history.slice(0, historyIndex + 1), url]
    const boundedLimit = Math.max(2, limit)
    const boundedHistory = nextHistory.length > boundedLimit
        ? [nextHistory[0], ...nextHistory.slice(-(boundedLimit - 1))]
        : nextHistory
    return { history: boundedHistory, historyIndex: boundedHistory.length - 1 }
}
