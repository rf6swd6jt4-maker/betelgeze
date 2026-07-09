export const WORKSPACE_TAB_FRAME_PARAM = "__betelgeze_tab"
export const WORKSPACE_TAB_FRAME_NAME_PREFIX = "betelgeze-tab:"
export const WORKSPACE_TAB_MESSAGE_SOURCE = "betelgeze-workspace-tabs"

export type WorkspaceTabParentMessage = {
    source: typeof WORKSPACE_TAB_MESSAGE_SOURCE
    target: "frame"
    tabId: string
    type: "activate" | "back" | "forward" | "navigate"
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
    const adminMatch = path.match(/^\/admin(?:\/(.*))?$/)
    const dashboardMatch = path.match(new RegExp(`^/dashboard/${workspaceSlug}(?:/(.*))?$`, "i"))
    const leadgenMatch = path.match(new RegExp(`^/leadgen/${workspaceSlug}(?:/(.*))?$`, "i"))

    if (adminMatch) {
        const suffix = adminMatch[1] ?? ""
        if (!suffix) return `${defaultWorkspaceUrl}${search}${hash}`
        if (suffix === "new") return `${defaultWorkspaceUrl}/clients/new${search}${hash}`
        if (suffix === "health") return `${defaultWorkspaceUrl}/health${search}${hash}`
        if (suffix === "invoices") return `${defaultWorkspaceUrl}/invoices${search}${hash}`
        if (suffix === "sales/new") return `${defaultWorkspaceUrl}/sales/new${search}${hash}`
        if (suffix.startsWith("client/")) return `${defaultWorkspaceUrl}/clients/${suffix.slice("client/".length)}${search}${hash}`
        return `${defaultWorkspaceUrl}/${suffix}${search}${hash}`
    }

    if (dashboardMatch) return `${defaultWorkspaceUrl}${dashboardMatch[1] ? `/${dashboardMatch[1]}` : ""}${search}${hash}`
    if (leadgenMatch) return `${defaultWorkspaceUrl}/leadgen${leadgenMatch[1] ? `/${leadgenMatch[1]}` : ""}${search}${hash}`
    return `${path}${search}${hash}`
}

export function workspaceTabFrameUrl(value: string, tabId: string, origin: string) {
    const parsed = new URL(value, origin)
    parsed.searchParams.set(WORKSPACE_TAB_FRAME_PARAM, tabId)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
}
