import type { RelationshipGanttPlan } from "./relationship-gantt"

export async function readRelationshipGanttPlan(input: { workspaceSlug: string; relationshipId: string; userId: string; signal: AbortSignal }, fetcher: typeof fetch = fetch): Promise<RelationshipGanttPlan> {
    const response = await fetcher(`/api/workspaces/${encodeURIComponent(input.workspaceSlug)}/relationships/${encodeURIComponent(input.relationshipId)}/gantt`, {
        method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal: input.signal,
        headers: { "Accept": "application/json", "x-workspace-user": input.userId },
    })
    if (!response.ok) {
        if ([401, 403, 404, 409].includes(response.status)) throw new Error("Your access or session changed. Reload the workspace to continue.")
        throw new Error("Could not refresh the plan. Please retry.")
    }
    const value = await response.json()
    if (value?.userId !== input.userId || value?.relationshipId !== input.relationshipId || !value.plan || !Array.isArray(value.plan.items) || !Array.isArray(value.plan.externalItems)) throw new Error("The plan could not be verified. Reload the workspace.")
    return value.plan as RelationshipGanttPlan
}

/** Per-mounted-plan coalescing; invalidation fences even transports ignoring abort. */
export function createRelationshipGanttReader(read: (signal: AbortSignal) => Promise<RelationshipGanttPlan>, accept: (plan: RelationshipGanttPlan) => void, failure: (error: unknown) => void) {
    let generation = 0
    let pending: Promise<void> | null = null
    let controller: AbortController | null = null
    let blocked = false
    let requested = false
    function invalidate() {
        generation += 1
        controller?.abort()
        controller = null
        pending = null
    }
    function refresh(): Promise<void> {
        requested = true
        if (blocked) return Promise.resolve()
        if (pending) return pending
        requested = false
        const revision = generation
        const requestController = new AbortController()
        controller = requestController
        const request = Promise.resolve().then(() => read(requestController.signal)).then((plan) => {
            if (revision === generation && !requestController.signal.aborted && !blocked) accept(plan)
        }).catch((error: unknown) => {
            if (revision === generation && !requestController.signal.aborted && !blocked) failure(error)
        }).finally(() => {
            if (pending === request) { pending = null; controller = null }
        })
        pending = request
        return request
    }
    function setBlocked(value: boolean) {
        if (value === blocked) return
        blocked = value
        if (value) { if (pending) requested = true; invalidate() }
        else if (requested) void refresh()
    }
    return { refresh, invalidate, setBlocked, dispose: () => { blocked = true; requested = false; invalidate() } }
}
