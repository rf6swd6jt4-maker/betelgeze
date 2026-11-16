import { CLIENT_RAIL_LIMIT } from "@/lib/client-rail"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { accessibleRelationshipIds, requireWorkspaceAccess } from "@/lib/workspace-access"
import { canAccessWorkspacePanel, workspacePanelByKey } from "@/lib/workspace-panels"

export const dynamic = "force-dynamic"

const headers = { "Cache-Control": "private, no-store" }
// A scoped member's relationships are filtered by id when the set is small, otherwise from one bounded name-ordered page.
const SCOPED_ID_FILTER_LIMIT = 200
const SCOPED_SCAN_LIMIT = 500

/**
 * The Today layout's client rail: current relationships the person may open, by name. Read-only and bounded. It reads
 * three columns in name order (relationships_workspace_person_idx) and stops after the limit, instead of the
 * Relationships panel's full list with its service, work, channel and creator lookups.
 */
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user, role, access } = await requireWorkspaceAccess(workspaceSlug)
    if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your account changed. Reload the page." }, { status: 409, headers })
    if (!canAccessWorkspacePanel(workspacePanelByKey("relationships"), role, access.capabilities)) return Response.json({ allowed: false, clients: [], truncated: false }, { headers })

    const allowed = await accessibleRelationshipIds(access)
    if (allowed && allowed.size === 0) return Response.json({ allowed: true, clients: [], truncated: false }, { headers })
    const filterById = allowed !== null && allowed.size <= SCOPED_ID_FILTER_LIMIT
    let query = supabaseAdmin.from("relationships").select("id, primary_person_name, business_name")
        .eq("workspace_id", workspace.id).neq("status", "archived")
        .order("primary_person_name", { ascending: true }).order("id", { ascending: true })
        .limit(allowed === null || filterById ? CLIENT_RAIL_LIMIT + 1 : SCOPED_SCAN_LIMIT)
    if (filterById) query = query.in("id", [...allowed])
    const { data, error } = await query
    if (error) return Response.json({ error: "Could not load your clients." }, { status: 503, headers })

    const rows = (data ?? []) as Array<{ id: string; primary_person_name: string | null; business_name: string | null }>
    const visible = allowed === null || filterById ? rows : rows.filter(row => allowed.has(row.id))
    // A scoped scan that filled its page may have missed later names, so it also reports itself as incomplete.
    const truncated = visible.length > CLIENT_RAIL_LIMIT || (allowed !== null && !filterById && rows.length === SCOPED_SCAN_LIMIT)
    return Response.json({
        allowed: true, truncated,
        clients: visible.slice(0, CLIENT_RAIL_LIMIT).map(row => ({ id: row.id, name: row.primary_person_name ?? "", business: row.business_name })),
    }, { headers })
}
