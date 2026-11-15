// Shared, side-effect-free rules for the reassign-and-remove dialog. The database commands in
// supabase/migrations/20261114180000_member_assignment_moves.sql remain the authority; these only shape the request.

export type FootprintKind = "client_manager" | "legacy_service_assignee" | "service_assignee" | "queue_member" | "work_owner" | "work_collaborator"

export type FootprintItem = {
    key: string
    kind: FootprintKind
    relationshipId: string | null
    recordId: string
    serviceKey: string | null
    serviceId: string | null
    client: string | null
    title: string
    fingerprint: string
    eligibleGroup: string
    blockedReason: string | null
}

export type MemberFootprint = {
    available: true
    targetId: string
    targetName: string
    targetRole: string | null
    items: FootprintItem[]
    eligibility: Record<string, string[]>
    people: Record<string, string>
    fingerprint: string
    history: { sellerClients: number }
}

export type MemberFootprintResponse = MemberFootprint | { available: false }

export type OffboardPlanEntry = { key: string; fingerprint: string; recipientId: string | null }

export type OffboardInput = {
    expectedUserId: string
    requestId: string
    targetId: string
    footprintFingerprint: string
    leaveOpenWork: boolean
    reason: string
    plan: OffboardPlanEntry[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MD5 = /^[0-9a-f]{32}$/
const KINDS = new Set<FootprintKind>(["client_manager", "legacy_service_assignee", "service_assignee", "queue_member", "work_owner", "work_collaborator"])

export const isWorkItem = (item: Pick<FootprintItem, "kind">) => item.kind === "work_owner" || item.kind === "work_collaborator"

export function footprintKindLabel(kind: FootprintKind) {
    switch (kind) {
        case "client_manager": return "Manages client"
        case "legacy_service_assignee": return "Service assignee (sale record)"
        case "service_assignee": return "Service assignee"
        case "queue_member": return "Shared service queue"
        case "work_owner": return "Owns task"
        case "work_collaborator": return "Collaborates on task"
    }
}

/** People listed for an item, excluding the person being removed. */
export function eligiblePeople(footprint: MemberFootprint, item: FootprintItem) {
    return (footprint.eligibility[item.eligibleGroup] ?? []).filter(id => id !== footprint.targetId)
}

/** Items no one can take: an imported service awaiting review, or nobody else eligible. */
export function blockedItems(footprint: MemberFootprint, leaveOpenWork: boolean) {
    return footprint.items.filter(item => !(leaveOpenWork && isWorkItem(item)) && (item.blockedReason || eligiblePeople(footprint, item).length === 0))
}

/** People who can take every item that still needs someone, for the single "Give everything to" choice. */
export function eligibleForEverything(footprint: MemberFootprint, leaveOpenWork: boolean) {
    const needing = footprint.items.filter(item => !(leaveOpenWork && isWorkItem(item)) && !item.blockedReason)
    const candidates = Object.keys(footprint.people).filter(id => id !== footprint.targetId)
    return candidates.filter(id => needing.every(item => eligiblePeople(footprint, item).includes(id)))
        .sort((left, right) => (footprint.people[left] ?? "").localeCompare(footprint.people[right] ?? ""))
}

/**
 * Builds the command plan. Each item goes to its override, else to the default recipient. With "leave open tasks
 * unassigned", tasks without an override are left out so the command clears them; everything else needs a recipient.
 */
export function buildOffboardPlan(footprint: MemberFootprint, everythingTo: string, overrides: Record<string, string>, leaveOpenWork: boolean) {
    const plan: OffboardPlanEntry[] = []
    const missing: FootprintItem[] = []
    for (const item of footprint.items) {
        const recipient = overrides[item.key] || everythingTo
        if (leaveOpenWork && isWorkItem(item) && !overrides[item.key]) continue
        if (!recipient || item.blockedReason || !eligiblePeople(footprint, item).includes(recipient)) { missing.push(item); continue }
        plan.push({ key: item.key, fingerprint: item.fingerprint, recipientId: recipient })
    }
    return { plan, missing }
}

export function validOffboardInput(input: OffboardInput) {
    return UUID.test(input.expectedUserId) && UUID.test(input.requestId) && UUID.test(input.targetId)
        && MD5.test(input.footprintFingerprint) && typeof input.leaveOpenWork === "boolean"
        && typeof input.reason === "string" && input.reason.trim().length > 0 && input.reason.length <= 1000
        && Array.isArray(input.plan) && input.plan.length <= 300
        && new Set(input.plan.map(entry => entry.key)).size === input.plan.length
        && input.plan.every(entry => typeof entry.key === "string" && entry.key.length <= 200 && KINDS.has(entry.key.split(":")[0] as FootprintKind)
            && MD5.test(entry.fingerprint) && (entry.recipientId === null || UUID.test(entry.recipientId)) && entry.recipientId !== input.targetId)
}

/** Converts the preview RPC result into the client shape, rejecting anything unexpected. */
export function parseFootprint(raw: unknown, targetId: string, people: Record<string, string>, targetName: string): MemberFootprint | null {
    if (!raw || typeof raw !== "object") return null
    const value = raw as Record<string, unknown>
    if (!Array.isArray(value.items) || typeof value.fingerprint !== "string" || !MD5.test(value.fingerprint)) return null
    const eligibility: Record<string, string[]> = {}
    for (const [group, ids] of Object.entries((value.eligibility ?? {}) as Record<string, unknown>)) {
        if (Array.isArray(ids)) eligibility[group] = ids.filter((id): id is string => typeof id === "string" && UUID.test(id))
    }
    const items: FootprintItem[] = []
    for (const entry of value.items as Array<Record<string, unknown>>) {
        if (!entry || typeof entry.key !== "string" || !KINDS.has(entry.kind as FootprintKind) || typeof entry.fingerprint !== "string") return null
        items.push({
            key: entry.key, kind: entry.kind as FootprintKind,
            relationshipId: typeof entry.relationshipId === "string" ? entry.relationshipId : null,
            recordId: String(entry.recordId ?? ""), serviceKey: typeof entry.serviceKey === "string" ? entry.serviceKey : null,
            serviceId: typeof entry.serviceId === "string" ? entry.serviceId : null,
            client: typeof entry.client === "string" ? entry.client : null, title: typeof entry.title === "string" ? entry.title : "Untitled",
            fingerprint: entry.fingerprint, eligibleGroup: typeof entry.eligibleGroup === "string" ? entry.eligibleGroup : "members",
            blockedReason: typeof entry.blockedReason === "string" ? entry.blockedReason : null,
        })
    }
    const history = value.history as { sellerClients?: unknown } | undefined
    return {
        available: true, targetId, targetName, targetRole: typeof value.targetRole === "string" ? value.targetRole : null,
        items, eligibility, people, fingerprint: value.fingerprint,
        history: { sellerClients: typeof history?.sellerClients === "number" ? history.sellerClients : 0 },
    }
}

export function footprintPeopleIds(raw: unknown): string[] {
    const groups = (raw as { eligibility?: Record<string, unknown> } | null)?.eligibility ?? {}
    return [...new Set(Object.values(groups).flatMap(ids => Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && UUID.test(id)) : []))]
}

export type ReassignInput = {
    expectedUserId: string
    requestId: string
    sourceId: string
    reason: string
    plan: OffboardPlanEntry[]
}

/** People eligible for every one of the given items, for the Staff panel's bulk "Move to". */
export function eligibleForItems(footprint: MemberFootprint, items: FootprintItem[]) {
    if (!items.length) return []
    return Object.keys(footprint.people).filter(id => id !== footprint.targetId && items.every(item => !item.blockedReason && eligiblePeople(footprint, item).includes(id)))
        .sort((left, right) => (footprint.people[left] ?? "").localeCompare(footprint.people[right] ?? ""))
}

export function validReassignInput(input: ReassignInput) {
    return UUID.test(input.expectedUserId) && UUID.test(input.requestId) && UUID.test(input.sourceId)
        && typeof input.reason === "string" && input.reason.trim().length > 0 && input.reason.length <= 1000
        && Array.isArray(input.plan) && input.plan.length > 0 && input.plan.length <= 300
        && new Set(input.plan.map(entry => entry.key)).size === input.plan.length
        && input.plan.every(entry => typeof entry.key === "string" && entry.key.length <= 200 && KINDS.has(entry.key.split(":")[0] as FootprintKind)
            && MD5.test(entry.fingerprint) && typeof entry.recipientId === "string" && UUID.test(entry.recipientId) && entry.recipientId !== input.sourceId)
}

export type StaffWorkloadRow = {
    userId: string
    name: string
    role: string
    joinedAt: string | null
    avatarSrc: string | null
    clients: number
    services: number
    queues: number
    tasks: number
}
