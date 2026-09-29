import { normalizeWorkspaceCapability, type WorkspaceCapability } from "@/lib/workspace-capabilities"
import type { WorkspaceRole } from "@/lib/workspace-roles"

// This is the compact, service-role-only RPC contract, not a second access policy.
// Fail closed on a mismatched migration/response instead of publishing partial data.
const RECORD_FIELDS = {
    relationships: { id: "id", primary_person_name: "text", business_name: "nullable", primary_email: "nullable", primary_phone: "nullable" },
    work_items: { id: "id", title: "text", description: "nullable", kind: "text", visibility: "text" },
    okrs: { id: "id", objective: "text", objective_type: "nullable", description: "nullable", status: "text", period_end: "text" },
    key_results: { id: "id", name: "text", description: "nullable" },
    admin_activity: { id: "id", summary: "text", category: "text", level: "text" },
    modules: { id: "id", name: "text", description: "text", status: "text" },
    services: { id: "id", name: "text", description: "nullable", state: "text" },
    clients: { id: "id", name: "nullable", email: "nullable", phone: "nullable", relationship_id: "id" },
    assets: { id: "id", title: "text" },
    notes: { id: "id", name: "text", description: "nullable" },
    channels: { relationship_id: "id", external_address: "text", provider: "text" },
    activities: { id: "id", relationship_id: "id", activity_text: "text", activity_type: "text" },
} as const

type Records = { [K in keyof typeof RECORD_FIELDS]: Array<{
    [F in keyof typeof RECORD_FIELDS[K]]: typeof RECORD_FIELDS[K][F] extends "nullable" ? string | null : string
}> }
export type SearchSnapshot = Records & {
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
    if (!object(value)) return invalid()
    const workspace = value.workspace
    if (!object(workspace) || typeof workspace.id !== "string" || !UUID.test(workspace.id)
        || workspace.slug !== workspaceSlug || typeof workspace.name !== "string"
        || typeof value.role !== "string" || !["owner", "admin", "staff"].includes(value.role) || typeof value.can_sell !== "boolean"
        || !Array.isArray(value.capabilities) || value.capabilities.some(item => !normalizeWorkspaceCapability(item))) return invalid()
    const privateAccess = value.role === "owner" || value.role === "admin"
    for (const [category, fields] of Object.entries(RECORD_FIELDS)) {
        const rows = value[category]
        const limit = category === "relationships" ? 8 : category === "channels" || category === "activities" ? 4 : 6
        if (!Array.isArray(rows) || rows.length > limit) return invalid()
        if (!privateAccess && !["relationships", "work_items", "channels"].includes(category) && rows.length) return invalid()
        for (const row of rows) {
            if (!object(row)) return invalid()
            for (const [field, kind] of Object.entries(fields)) {
                const cell = row[field]
                if (kind === "nullable" && cell === null) continue
                if (typeof cell !== "string" || (kind === "id" && !UUID.test(cell))) return invalid()
            }
            if (category === "work_items" && (row.visibility !== "workspace" && row.visibility !== "admins_only"
                || !privateAccess && row.visibility !== "workspace")) return invalid()
        }
    }
    return value as SearchSnapshot
}
