/** Stable, content-free vocabulary shared by the browser, ingestion and benchmarks. */
export const WORKSPACE_PERFORMANCE_OPERATIONS = [
    "navigation", "panel_load", "tab_switch", "field_edit", "draft_save", "command", "launch", "media", "conversation_switch",
] as const
export const WORKSPACE_PERFORMANCE_BOUNDARIES = [
    "code_ready", "data_ready", "meaningful_ready", "local_persisted", "server_ack", "external_completed", "visual_response",
] as const
export const WORKSPACE_PERFORMANCE_SECTIONS = [
    "workspace", "relationships", "work", "work-items", "assets", "appointment-setting", "onboarding",
    "onboarding-builder", "communications", "settings", "admin", "leadgen", "no-access", "portal", "unknown",
] as const
export const WORKSPACE_PERFORMANCE_COMMANDS = [
    "unknown", "relationship.update", "relationship.create", "relationship.archive", "work-item.update",
    "appointment.draft", "appointment.submit", "settings.update", "message.send", "message.edit", "message.checklist",
] as const

export type WorkspacePerformanceOperation = typeof WORKSPACE_PERFORMANCE_OPERATIONS[number]
export type WorkspacePerformanceBoundary = typeof WORKSPACE_PERFORMANCE_BOUNDARIES[number]
export type WorkspacePerformanceSection = typeof WORKSPACE_PERFORMANCE_SECTIONS[number]
export type WorkspacePerformanceCommand = typeof WORKSPACE_PERFORMANCE_COMMANDS[number]
export type WorkspacePerformanceCacheState = "memory" | "persistent" | "network" | "mixed" | "unknown"
export type WorkspacePerformanceRenderer = "native" | "frame" | "standalone" | "unknown"
export type WorkspacePerformanceOutcome = "completed" | "failed" | "aborted" | "timeout"

export type WorkspacePerformanceSample = {
    schemaVersion: 1
    sampleId: string
    operation: WorkspacePerformanceOperation
    command: WorkspacePerformanceCommand
    routeSection: WorkspacePerformanceSection
    cacheState: WorkspacePerformanceCacheState
    renderer: WorkspacePerformanceRenderer
    background: boolean
    outcome: WorkspacePerformanceOutcome
    completionBoundary: WorkspacePerformanceBoundary | null
    durationMs: number
    boundaries: Partial<Record<WorkspacePerformanceBoundary, number>>
    startedVisible: boolean
    endedVisible: boolean
    visibilityChanges: number
    hiddenDurationMs: number
    // A lifecycle freeze is evidence of suspension. A long duration alone is not.
    suspended: boolean
}

export type WorkspacePerformanceStart = Pick<WorkspacePerformanceSample, "sampleId" | "operation" | "routeSection"> & Partial<Pick<WorkspacePerformanceSample, "command" | "cacheState" | "renderer" | "background">>

function allowed<T extends string>(value: unknown, values: readonly T[]): value is T {
    return typeof value === "string" && values.includes(value as T)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_DURATION_MS = 3_600_000

function milliseconds(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_DURATION_MS
        ? Math.round(value * 10) / 10 : null
}

/** Drop unknown keys and reject malformed samples; never preserve caller-provided text. */
export function sanitizeWorkspacePerformanceSample(value: unknown): WorkspacePerformanceSample | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const input = value as Record<string, unknown>
    if (input.schemaVersion !== 1 || typeof input.sampleId !== "string" || !UUID_PATTERN.test(input.sampleId)) return null
    if (!allowed(input.operation, WORKSPACE_PERFORMANCE_OPERATIONS) || !allowed(input.routeSection, WORKSPACE_PERFORMANCE_SECTIONS)) return null
    if (!allowed(input.outcome, ["completed", "failed", "aborted", "timeout"] as const)) return null
    const durationMs = milliseconds(input.durationMs)
    const hiddenDurationMs = milliseconds(input.hiddenDurationMs)
    if (durationMs === null || hiddenDurationMs === null || hiddenDurationMs > durationMs) return null
    const boundaries: WorkspacePerformanceSample["boundaries"] = {}
    if (input.boundaries && typeof input.boundaries === "object" && !Array.isArray(input.boundaries)) {
        for (const boundary of WORKSPACE_PERFORMANCE_BOUNDARIES) {
            const timing = milliseconds((input.boundaries as Record<string, unknown>)[boundary])
            if (timing !== null && timing <= durationMs) boundaries[boundary] = timing
        }
    }
    const completionBoundary = allowed(input.completionBoundary, WORKSPACE_PERFORMANCE_BOUNDARIES) ? input.completionBoundary : null
    // A completed operation needs a real reported boundary, not merely a resolved fetch.
    if (input.outcome === "completed" && (!completionBoundary || boundaries[completionBoundary] === undefined)) return null
    return {
        schemaVersion: 1,
        sampleId: input.sampleId,
        operation: input.operation,
        command: allowed(input.command, WORKSPACE_PERFORMANCE_COMMANDS) ? input.command : "unknown",
        routeSection: input.routeSection,
        cacheState: allowed(input.cacheState, ["memory", "persistent", "network", "mixed", "unknown"] as const) ? input.cacheState : "unknown",
        renderer: allowed(input.renderer, ["native", "frame", "standalone", "unknown"] as const) ? input.renderer : "unknown",
        background: input.background === true,
        outcome: input.outcome,
        completionBoundary,
        durationMs,
        boundaries,
        startedVisible: input.startedVisible === true,
        endedVisible: input.endedVisible === true,
        visibilityChanges: typeof input.visibilityChanges === "number" && Number.isFinite(input.visibilityChanges)
            ? Math.max(0, Math.min(10_000, Math.floor(input.visibilityChanges))) : 0,
        hiddenDurationMs,
        suspended: input.suspended === true,
    }
}

/** Clock/visibility injection makes lifecycle handling testable without a browser. */
export function createWorkspacePerformanceMeasurement(input: WorkspacePerformanceStart, clock: () => number, initiallyVisible: boolean) {
    const startedAt = clock()
    const boundaries: WorkspacePerformanceSample["boundaries"] = {}
    let visible = initiallyVisible
    let hiddenAt = visible ? null : startedAt
    let hiddenDurationMs = 0
    let visibilityChanges = 0
    let suspended = false
    let finished = false
    const elapsed = () => Math.max(0, clock() - startedAt)
    return {
        mark(boundary: WorkspacePerformanceBoundary) {
            if (!finished && boundaries[boundary] === undefined) boundaries[boundary] = elapsed()
        },
        visibility(nextVisible: boolean) {
            if (finished || nextVisible === visible) return
            const now = clock()
            if (hiddenAt !== null) hiddenDurationMs += Math.max(0, now - hiddenAt)
            hiddenAt = nextVisible ? null : now
            visible = nextVisible
            visibilityChanges += 1
        },
        suspend() { if (!finished) suspended = true },
        finish(outcome: WorkspacePerformanceOutcome, completionBoundary?: WorkspacePerformanceBoundary): WorkspacePerformanceSample | null {
            if (finished) return null
            finished = true
            const durationMs = elapsed()
            return sanitizeWorkspacePerformanceSample({
                schemaVersion: 1, ...input,
                command: input.command ?? "unknown", cacheState: input.cacheState ?? "unknown", renderer: input.renderer ?? "unknown",
                background: input.background === true, outcome, completionBoundary: completionBoundary ?? null,
                durationMs, boundaries, startedVisible: initiallyVisible, endedVisible: visible, visibilityChanges,
                hiddenDurationMs: Math.min(durationMs, hiddenDurationMs + (hiddenAt === null ? 0 : Math.max(0, clock() - hiddenAt))),
                suspended,
            })
        },
    }
}
