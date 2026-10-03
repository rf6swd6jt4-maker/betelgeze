import "server-only"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { assetHref, fulfilmentDetailHref, onboardingDetailHref, relationshipHubHref, workItemHref } from "@/lib/relationships"
import { chatRecordReferences, recordReferenceKey, type RecordReference, type RecordReferenceResult } from "@/lib/communications/references"

export const REFERENCE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const REFERENCE_BATCH_LIMIT = 40

export class CommunicationReferenceError extends Error {
    constructor(message: string, public readonly status: number) { super(message) }
}

export function parseReferenceBatch(value: unknown): RecordReference[] | null {
    if (!Array.isArray(value) || value.length > REFERENCE_BATCH_LIMIT) return null
    const references = new Map<string, RecordReference>()
    for (const entry of value) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null
        const { type, id } = entry as Record<string, unknown>
        if ((type !== "work_item" && type !== "asset" && type !== "relationship") || typeof id !== "string" || !REFERENCE_UUID_PATTERN.test(id)) return null
        const reference = { type, id: id.toLowerCase() } satisfies RecordReference
        references.set(recordReferenceKey(reference), reference)
    }
    return [...references.values()]
}

/** Database titles may contain line breaks or Unicode characters whose UTF-16
 * length exceeds the SQL character bound. Keep authorised labels compact without
 * rejecting the whole batch or returning a split surrogate pair. */
function referenceDisplayText(value: string, limit: number) {
    return value.replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim().slice(0, limit).replace(/[\uD800-\uDBFF]$/u, "").trimEnd()
}

type ReadInput = { workspaceSlug: string; userId: string; conversationId: string; signal?: AbortSignal }
export async function readCommunicationReferences(input: ReadInput & ({ query: string; references?: never } | { query?: never; references: RecordReference[] })) {
    const operation = supabaseAdmin.rpc("read_communication_references", {
        p_workspace_slug: input.workspaceSlug,
        p_user_id: input.userId,
        p_conversation_id: input.conversationId,
        p_query: input.query ?? null,
        p_references: input.references ?? null,
    })
    const { data, error } = await (input.signal ? operation.abortSignal(input.signal) : operation)
    if (error) throw new CommunicationReferenceError("References are temporarily unavailable.", 503)
    if (data === null) throw new CommunicationReferenceError("Conversation is unavailable.", 403)
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new CommunicationReferenceError("References are temporarily unavailable.", 503)
    const snapshot = data as { scope?: { userId?: string; workspaceId?: string }; relationshipRoute?: string; results?: unknown[] }
    if (snapshot.scope?.userId !== input.userId || !snapshot.scope.workspaceId || !REFERENCE_UUID_PATTERN.test(snapshot.scope.workspaceId)
        || !Array.isArray(snapshot.results) || snapshot.results.length > (input.references ? REFERENCE_BATCH_LIMIT : 4)
        || !["relationships", "onboarding", "work"].includes(snapshot.relationshipRoute ?? "")) {
        throw new CommunicationReferenceError("References are temporarily unavailable.", 503)
    }
    const results: RecordReferenceResult[] = snapshot.results.map((entry) => {
        const identity = parseReferenceBatch([entry])?.[0]
        const row = entry as { label?: unknown; detail?: unknown }
        if (!identity || typeof row.label !== "string" || (row.detail != null && typeof row.detail !== "string")) {
            throw new CommunicationReferenceError("References are temporarily unavailable.", 503)
        }
        const href = identity.type === "work_item" ? workItemHref(input.workspaceSlug, identity.id)
            : identity.type === "asset" ? assetHref(input.workspaceSlug, identity.id)
            : snapshot.relationshipRoute === "relationships" ? relationshipHubHref(input.workspaceSlug, identity.id)
            : snapshot.relationshipRoute === "onboarding" ? onboardingDetailHref(input.workspaceSlug, identity.id)
            : fulfilmentDetailHref(input.workspaceSlug, identity.id)
        const label = referenceDisplayText(row.label, 240) || "Untitled"
        const detail = typeof row.detail === "string" ? referenceDisplayText(row.detail, 160) : ""
        return { ...identity, label, ...(detail ? { detail } : {}), href }
    })
    return { scope: { userId: input.userId, workspaceId: snapshot.scope.workspaceId }, results }
}

/** No request at all for ordinary messages. Already-stored references may survive
 * editing after access loss; only newly introduced identities require permission.
 * POST callers must recover a durable clientRequestId before invoking this. */
export async function validateCommunicationReferences(input: ReadInput & { workspaceId: string; body: string; originalBody?: string }) {
    const parsed = chatRecordReferences(input.body)
    if (!parsed.length) return
    const unique = new Map(parsed.map(({ type, id }) => [recordReferenceKey({ type, id }), { type, id }]))
    if (unique.size > REFERENCE_BATCH_LIMIT) throw new CommunicationReferenceError("A message can contain up to 40 different references.", 400)
    const original = new Set(chatRecordReferences(input.originalBody ?? "").map(recordReferenceKey))
    const added = [...unique.values()].filter(reference => !original.has(recordReferenceKey(reference)))
    if (!added.length) return
    const resolved = await readCommunicationReferences({ ...input, references: added })
    const allowed = new Set(resolved.results.map(recordReferenceKey))
    if (resolved.scope.workspaceId !== input.workspaceId || added.some(reference => !allowed.has(recordReferenceKey(reference)))) {
        throw new CommunicationReferenceError("A reference is no longer available. Remove it and try again.", 403)
    }
}
