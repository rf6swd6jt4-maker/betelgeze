import type { PersistedRelationshipDraft } from "./relationship-draft-queue"
export type RelationshipBackgroundValues = {
    primaryPersonName: string
    businessName: string
    primaryContactRole: string
    primaryPhone: string
    whatsappPhone: string
    communicationPrimaryProvider: "meta_whatsapp" | "twilio_sms"
    communicationDeliveryMode: "primary_only" | "primary_with_fallback" | "mirror"
    primaryEmail: string
    description: string
}
export type RelationshipDraft = RelationshipBackgroundValues & {
    sellerUserId: string
    fulfilmentManagerUserId: string
    fulfilmentTeamId: string
    projectTimeframeDays: number | null
    serviceAssignees: Record<string, string>
    selectedCodes: string[]
    upfrontPrices: Record<string, number>
    recurringPrices: Record<string, number>
    currency: string
    billingInterval: "week" | "month" | "year"
    billingIntervalCount: number
}
export type RelationshipBackgroundCommand = { requestId: string; expectedUserId: string; expectedUpdatedAt: string; values: RelationshipBackgroundValues }
export type RelationshipBackgroundResult = { ok: true; version: string; currentVersion?: string; values: RelationshipBackgroundValues } | { ok: false; error: string; conflict?: boolean; version?: string; values?: RelationshipBackgroundValues }
export const RELATIONSHIP_BACKGROUND_FIELDS = ["primaryPersonName", "businessName", "primaryContactRole", "primaryPhone", "whatsappPhone", "communicationPrimaryProvider", "communicationDeliveryMode", "primaryEmail", "description"] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function relationshipBackgroundValues(value: RelationshipBackgroundValues): RelationshipBackgroundValues {
    return Object.fromEntries(RELATIONSHIP_BACKGROUND_FIELDS.map((key) => [key, value[key]])) as RelationshipBackgroundValues
}
export function parseRelationshipBackgroundCommand(value: unknown): RelationshipBackgroundCommand | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const row = value as Record<string, unknown>
    if (typeof row.requestId !== "string" || !UUID.test(row.requestId) || typeof row.expectedUserId !== "string" || !UUID.test(row.expectedUserId)
        || typeof row.expectedUpdatedAt !== "string" || row.expectedUpdatedAt.length > 50 || !Number.isFinite(Date.parse(row.expectedUpdatedAt))
        || !row.values || typeof row.values !== "object" || Array.isArray(row.values)) return null
    const values = row.values as Record<string, unknown>
    if (Object.keys(values).length !== RELATIONSHIP_BACKGROUND_FIELDS.length || RELATIONSHIP_BACKGROUND_FIELDS.some((key) => typeof values[key] !== "string" || (values[key] as string).length > (key === "description" ? 20_000 : 2_000))) return null
    if (!["meta_whatsapp", "twilio_sms"].includes(values.communicationPrimaryProvider as string) || !["primary_only", "primary_with_fallback", "mirror"].includes(values.communicationDeliveryMode as string)) return null
    return { requestId: row.requestId, expectedUserId: row.expectedUserId, expectedUpdatedAt: row.expectedUpdatedAt, values: relationshipBackgroundValues(values as RelationshipBackgroundValues) }
}
export function relationshipBackgroundCommandIsSameOrigin(request: Request) {
    return request.headers.get("origin") === new URL(request.url).origin && request.headers.get("sec-fetch-site") !== "cross-site"
}
export async function sendRelationshipBackgroundCommand(workspaceSlug: string, relationshipId: string, command: RelationshipBackgroundCommand): Promise<RelationshipBackgroundResult> {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/relationships/${encodeURIComponent(relationshipId)}/background`, {
        method: "POST", credentials: "same-origin", redirect: "error", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command), signal: AbortSignal.timeout(20_000),
    })
    if (response.status >= 500 || !response.headers.get("content-type")?.includes("application/json")) throw new Error("The save could not be confirmed. Your relationship draft is preserved for retry.")
    return response.json()
}

const placeholder = "00000000-0000-4000-8000-000000000000"
function parseDraft(value: unknown, version: string): RelationshipDraft | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const draft = value as RelationshipDraft
    if (!parseRelationshipBackgroundCommand({ requestId: placeholder, expectedUserId: placeholder, expectedUpdatedAt: version, values: relationshipBackgroundValues(draft) })) return null
    for (const field of ["sellerUserId", "fulfilmentManagerUserId", "fulfilmentTeamId", "currency"] as const) if (typeof draft[field] !== "string" || draft[field].length > 2000) return null
    if (!["week", "month", "year"].includes(draft.billingInterval) || !Number.isSafeInteger(draft.billingIntervalCount)) return null
    if (draft.projectTimeframeDays !== null && !Number.isFinite(draft.projectTimeframeDays)) return null
    if (!Array.isArray(draft.selectedCodes) || draft.selectedCodes.length > 500 || draft.selectedCodes.some((code) => typeof code !== "string" || code.length > 200)) return null
    for (const field of ["serviceAssignees", "upfrontPrices", "recurringPrices"] as const) {
        const map = draft[field]
        if (!map || typeof map !== "object" || Array.isArray(map) || Object.keys(map).length > 500) return null
        if (Object.entries(map).some(([key, value]) => key.length > 200 || (field === "serviceAssignees" ? typeof value !== "string" || value.length > 2000 : typeof value !== "number" || !Number.isFinite(value)))) return null
    }
    return { ...relationshipBackgroundValues(draft), sellerUserId: draft.sellerUserId, fulfilmentManagerUserId: draft.fulfilmentManagerUserId,
        fulfilmentTeamId: draft.fulfilmentTeamId, projectTimeframeDays: draft.projectTimeframeDays, serviceAssignees: draft.serviceAssignees,
        selectedCodes: draft.selectedCodes, upfrontPrices: draft.upfrontPrices, recurringPrices: draft.recurringPrices, currency: draft.currency,
        billingInterval: draft.billingInterval, billingIntervalCount: draft.billingIntervalCount,
    }
}
export function parsePersistedRelationshipDraft(value: unknown): PersistedRelationshipDraft | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const row = value as PersistedRelationshipDraft
    if (typeof row.version !== "string" || row.version.length > 50 || !Number.isFinite(Date.parse(row.version))) return null
    const baseline = parseDraft(row.baseline, row.version), draft = parseDraft(row.draft, row.version)
    if (!baseline || !draft) return null
    if (row.pending && ((row.pending.transport !== "action" && row.pending.transport !== "command") || !parseRelationshipBackgroundCommand({ requestId: row.pending.requestId, expectedUserId: placeholder, expectedUpdatedAt: row.pending.version, values: row.pending.values }))) return null
    return { version: row.version, baseline, draft, pending: row.pending, conflict: row.conflict === true }
}

/** Independent journals prevent two browser windows overwriting each other's draft. */
export function createRelationshipDraftStorage(local: Storage, session: Storage, baseKey: string) {
    const writerKey = "betelgeze:relationship-draft-writer"
    const writer = session.getItem(writerKey) ?? crypto.randomUUID()
    session.setItem(writerKey, writer)
    const key = `${baseKey}:${writer}`
    const decode = (raw: string) => {
        const value = parsePersistedRelationshipDraft(JSON.parse(raw))
        if (!value) throw new Error("Invalid saved relationship draft")
        return value
    }
    return {
        read(): PersistedRelationshipDraft | null {
            const own = local.getItem(key)
            if (own !== null) return decode(own)
            const candidates: PersistedRelationshipDraft[] = []
            for (let index = 0; index < local.length; index++) {
                const candidateKey = local.key(index)
                if (!candidateKey || (candidateKey !== baseKey && !candidateKey.startsWith(`${baseKey}:`))) continue
                const raw = local.getItem(candidateKey)
                if (raw !== null) candidates.push(decode(raw))
            }
            const recovered = candidates.sort((left, right) => right.version.localeCompare(left.version))[0]
            // A different window may still be editing. Offer explicit recovery;
            // never automatically replay another window's copy of the draft.
            return recovered ? { ...recovered, conflict: true } : null
        },
        write(value: PersistedRelationshipDraft | null) {
            if (value) local.setItem(key, JSON.stringify(value))
            else local.removeItem(key)
        },
    }
}
