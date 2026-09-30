import { normalizeWorkspaceCapability, type WorkspaceCapability } from "@/lib/workspace-capabilities"
import type { WorkspaceRole } from "@/lib/workspace-roles"

// This is the compact, service-role-only RPC contract, not a second access policy.
// Fail closed on a mismatched migration/response instead of publishing partial data.
const RECORD_FIELDS = {
    relationships: { id: "id", primary_person_name: "text", business_name: "nullable", primary_email: "nullable", primary_phone: "nullable", status: "text", match_rank: "rank", match_field: "text" },
    work_items: { id: "id", title: "text", description: "nullable", kind: "text", visibility: "text", archived: "boolean" },
    okrs: { id: "id", objective: "text", objective_type: "nullable", description: "nullable", status: "text", period_end: "text" },
    key_results: { id: "id", name: "text", description: "nullable" },
    admin_activity: { id: "id", summary: "text", category: "text", level: "text" },
    modules: { id: "id", name: "text", description: "text", status: "text" },
    services: { id: "id", name: "text", description: "nullable", state: "text" },
    assets: { id: "id", title: "text", archived: "boolean" },
    notes: { id: "id", name: "text", description: "nullable" },
    channels: { relationship_id: "id", external_address: "text", provider: "text" },
    activities: { id: "id", relationship_id: "id", activity_text: "text", activity_type: "text" },
    related: { kind: "text", id: "id", relationship_id: "id", relationship_name: "text", title: "text", status: "nullable", session_id: "nullableId", due_date: "nullable", visibility: "nullable" },
} as const

type Records = { [K in keyof typeof RECORD_FIELDS]: Array<{
    [F in keyof typeof RECORD_FIELDS[K]]: typeof RECORD_FIELDS[K][F] extends "boolean" ? boolean : typeof RECORD_FIELDS[K][F] extends "rank" ? number : typeof RECORD_FIELDS[K][F] extends "nullable" | "nullableId" ? string | null : string
}> }
export type SearchSnapshot = Records & {
    schema_version: 2
    workspace: { id: string; slug: string; name: string }
    role: WorkspaceRole
    capabilities: WorkspaceCapability[]
    can_sell: boolean
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function parseSearchSnapshot(value: unknown, workspaceSlug: string): SearchSnapshot {
    const invalid = () => { throw new Error("Invalid search snapshot") }
    if (!object(value) || value.schema_version !== 2) return invalid()
    const workspace = value.workspace
    if (!object(workspace) || typeof workspace.id !== "string" || !UUID.test(workspace.id)
        || workspace.slug !== workspaceSlug || typeof workspace.name !== "string"
        || typeof value.role !== "string" || !["owner", "admin", "staff"].includes(value.role) || typeof value.can_sell !== "boolean"
        || !Array.isArray(value.capabilities) || value.capabilities.some(item => !normalizeWorkspaceCapability(item))) return invalid()
    const privateAccess = value.role === "owner" || value.role === "admin"
    for (const [category, fields] of Object.entries(RECORD_FIELDS)) {
        const rows = value[category]
        const limit = category === "related" ? 10 : category === "relationships" ? 8 : category === "channels" || category === "activities" ? 4 : 6
        if (!Array.isArray(rows) || rows.length > limit) return invalid()
        if (!privateAccess && !["relationships", "work_items", "channels", "related"].includes(category) && rows.length) return invalid()
        for (const row of rows) {
            if (!object(row)) return invalid()
            for (const [field, kind] of Object.entries(fields)) {
                const cell = row[field]
                if ((kind === "nullable" || kind === "nullableId") && cell === null) continue
                if (kind === "boolean") {
                    if (typeof cell !== "boolean") return invalid()
                    continue
                }
                if (kind === "rank") {
                    if (typeof cell !== "number" || ![0, 1, 2, 3, 5].includes(cell)) return invalid()
                    continue
                }
                if (typeof cell !== "string" || ((kind === "id" || kind === "nullableId") && !UUID.test(cell))) return invalid()
            }
            if (category === "relationships" && (!["active", "waiting", "blocked", "completed", "lost", "archived"].includes(String(row.status))
                || !["id", "name", "business", "email", "phone", "notes", "details"].includes(String(row.match_field)))) return invalid()
            if (category === "work_items" && (row.visibility !== "workspace" && row.visibility !== "admins_only"
                || !privateAccess && row.visibility !== "workspace")) return invalid()
        }
    }
    const snapshot = value as SearchSnapshot
    const seeds = new Map(snapshot.relationships.filter(row => row.status !== "archived" && row.match_rank <= 3).map(row => [row.id, row]))
    const relatedCounts = new Map<string, number>()
    const relatedSeeds = new Set<string>()
    for (const row of snapshot.related) {
        const seed = seeds.get(row.relationship_id)
        if (!seed || seed.primary_person_name !== row.relationship_name
            || !["onboarding", "client_chat", "team_chat", "work_item"].includes(row.kind)) return invalid()
        relatedSeeds.add(row.relationship_id)
        const key = `${row.relationship_id}:${row.kind}`
        const count = (relatedCounts.get(key) ?? 0) + 1
        relatedCounts.set(key, count)
        if (relatedSeeds.size > 2 || count > (row.kind === "work_item" ? 2 : 1)) return invalid()
        if (row.kind === "onboarding") {
            if ((!privateAccess && !snapshot.capabilities.includes("onboarding.manage")) || row.id !== row.relationship_id || row.visibility !== null) return invalid()
        } else if (row.session_id !== null) return invalid()
        if (row.kind === "client_chat" && row.id !== row.relationship_id) return invalid()
        if (row.kind === "work_item") {
            if (!["todo", "doing", "waiting", "blocked"].includes(row.status ?? "")
                || !["workspace", "admins_only"].includes(row.visibility ?? "")
                || (!privateAccess && row.visibility !== "workspace")
                || (row.due_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(row.due_date))) return invalid()
        } else if (row.visibility !== null || row.due_date !== null) return invalid()
    }
    return snapshot
}
