import { footprintPeopleIds, parseFootprint } from "@/lib/member-offboarding"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const headers = { "Cache-Control": "private, no-store" }

/** Everything a member can hand over, for the reassign-and-remove dialog. Owners and admins only; read-only. */
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string; userId: string }> }) {
    const { workspaceSlug, userId } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your account changed. Reload the page." }, { status: 409, headers })
    if (!UUID_PATTERN.test(userId)) return Response.json({ error: "Person not found." }, { status: 404, headers })

    const { data, error } = await supabaseAdmin.rpc("preview_workspace_member_footprint", {
        p_workspace: workspace.id, p_actor: user.id, p_target: userId, p_service: null,
    })
    // Until the migration is applied, the dialog falls back to the plain removal it replaces.
    if (error?.code === "PGRST202" || error?.code === "42883") return Response.json({ available: false }, { headers })
    if (error) return Response.json({ error: error.code === "P0001" ? error.message : "Could not load this person's assignments." }, { status: error.code === "P0001" ? 422 : 503, headers })

    const ids = [...new Set([userId, ...footprintPeopleIds(data)])]
    const { data: profiles, error: profileError } = await supabaseAdmin.from("user_profiles").select("user_id, username, display_name").in("user_id", ids)
    if (profileError) return Response.json({ error: "Could not load people's names." }, { status: 503, headers })
    const people: Record<string, string> = {}
    for (const profile of profiles ?? []) people[profile.user_id] = profile.display_name?.trim() || profile.username || "Workspace member"
    for (const id of ids) people[id] ??= "Workspace member"
    const targetName = people[userId]
    delete people[userId]

    const footprint = parseFootprint(data, userId, people, targetName)
    if (!footprint) return Response.json({ error: "This person's assignments could not be read." }, { status: 503, headers })
    return Response.json(footprint, { headers })
}
