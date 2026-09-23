// Code-owned quarantine. Restore admission only after reviewing accepted work
// and external workers; changing this policy never rewrites persisted status.
const OPERATIONS_ENABLED = false

export const LEADGEN_PAUSED_MESSAGE = "Lead Gen is paused. Existing leads and poll history remain available to administrators; no new polls, imports, or changes are accepted."

export function leadgenOperationsAvailable(): boolean {
    return OPERATIONS_ENABLED
}

export function requireLeadgenOperations() {
    if (!leadgenOperationsAvailable()) throw new Error(LEADGEN_PAUSED_MESSAGE)
}

export function leadgenPausedResponse() {
    return Response.json({ status: "paused", error: LEADGEN_PAUSED_MESSAGE }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
    })
}
