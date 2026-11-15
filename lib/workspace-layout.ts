// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { workspaceNativePanelsEnabled, workspacePerformanceEnabled } from "./workspace-native.ts"

export type WorkspaceLayout = "tabs" | "today"

type LayoutSettings = Record<string, string | undefined> & {
    WORKSPACE_NATIVE_PANELS?: string
    WORKSPACE_PERFORMANCE_USERS?: string
    WORKSPACE_TODAY_LAYOUT?: string
    WORKSPACE_TODAY_LAYOUT_USERS?: string
}

/**
 * Which workspace layout a person gets. "today" is the redesigned shell (Today column, work area, context column, no
 * tabs) and is off unless WORKSPACE_TODAY_LAYOUT names the workspace (or "all"). WORKSPACE_TODAY_LAYOUT_USERS optionally
 * narrows it to listed people. It builds on the native panel renderer, so it also requires the native panel gates.
 * Rollout selection only: every read and command keeps its usual authorization.
 */
export function workspaceLayoutFor(workspaceId: string, userId: string | undefined, settings: LayoutSettings = process.env): WorkspaceLayout {
    const native = workspacePerformanceEnabled(workspaceId, userId, settings.WORKSPACE_NATIVE_PANELS, settings.WORKSPACE_PERFORMANCE_USERS)
    if (!native || !workspaceNativePanelsEnabled(workspaceId, settings.WORKSPACE_TODAY_LAYOUT)) return "tabs"
    if (!settings.WORKSPACE_TODAY_LAYOUT_USERS?.trim()) return "today"
    return userId && workspaceNativePanelsEnabled(userId, settings.WORKSPACE_TODAY_LAYOUT_USERS) ? "today" : "tabs"
}
