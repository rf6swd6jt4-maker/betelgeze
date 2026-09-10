import { recordVersionKey } from "../record-version.js"

export type CommunicationHistoryCursor = { createdAt: string; id: string }
export type CommunicationHistoryPage<M> = { messages: M[]; hasMore: boolean; nextBefore: CommunicationHistoryCursor | null }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const COMMUNICATION_HISTORY_BOUNDARY_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff"

export function communicationHistoryRpcMissing(error: { code?: string } | null) {
    return error?.code === "42883" || error?.code === "PGRST202"
}

/** Before the additive RPC is installed, preserve the existing authorized
 * history window. Never widen access or claim older rows beyond that window. */
export function legacyCommunicationHistoryPage<M extends CommunicationHistoryCursor>(messages: M[], before: CommunicationHistoryCursor): CommunicationHistoryPage<M> {
    const compare = (left: CommunicationHistoryCursor, right: CommunicationHistoryCursor) => recordVersionKey(left.createdAt).localeCompare(recordVersionKey(right.createdAt)) || left.id.localeCompare(right.id)
    const eligible = messages.filter((message) => compare(message, before) < 0).sort((left, right) => compare(right, left))
    const page = eligible.slice(0, 60).reverse()
    return { messages: page, hasMore: eligible.length > 60, nextBefore: page[0] ? { id: page[0].id, createdAt: page[0].createdAt } : null }
}

export function communicationHistoryCursor(value: unknown): CommunicationHistoryCursor | null {
    if (!value || typeof value !== "object") return null
    const row = value as Record<string, unknown>
    // Preserve PostgreSQL's microseconds; Date.toISOString would round the cursor.
    return typeof row.createdAt === "string" && row.createdAt.length <= 40 && Number.isFinite(Date.parse(row.createdAt)) && typeof row.id === "string" && uuid.test(row.id)
        ? { createdAt: row.createdAt, id: row.id } : null
}

export function communicationHistoryPage<M>(value: unknown, parse: (row: unknown) => M | null): CommunicationHistoryPage<M> {
    if (!value || typeof value !== "object") throw new Error("Invalid conversation history response.")
    const row = value as Record<string, unknown>
    if (!Array.isArray(row.messages) || typeof row.hasMore !== "boolean") throw new Error("Invalid conversation history response.")
    const nextBefore = communicationHistoryCursor(row.nextBefore)
    if (row.hasMore && !nextBefore) throw new Error("Missing conversation history cursor.")
    return { messages: row.messages.flatMap((message) => parse(message) ?? []).reverse(), hasMore: row.hasMore, nextBefore }
}
