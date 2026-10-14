export const isQueueUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
export type ServiceRoster = { instanceId: string; version: number; primaryId: string; memberIds: string[]; people: Array<{id: string; name: string}> }
export type ServiceRosterRequest = { instanceId: string; version: number; members: string[]; requestId: string }
export function isServiceRosterRequest(value: unknown): value is ServiceRosterRequest {
    if (!value || typeof value !== "object") return false
    const v = value as ServiceRosterRequest
    return isQueueUuid(v.instanceId) && isQueueUuid(v.requestId) && Number.isSafeInteger(v.version) && v.version >= 0
        && Array.isArray(v.members) && v.members.length <= 19 && v.members.every(isQueueUuid) && new Set(v.members).size === v.members.length
}
export type QueueCommandRequest = { id: string; action: "start" | "pause" | "complete"; version: string; requestId: string }
export function isQueueCommandRequest(value: unknown): value is QueueCommandRequest {
    if (!value || typeof value !== "object") return false
    const v = value as QueueCommandRequest
    return isQueueUuid(v.id) && isQueueUuid(v.requestId) && ["start", "pause", "complete"].includes(v.action)
        && typeof v.version === "string" && Number.isFinite(Date.parse(v.version))
}
