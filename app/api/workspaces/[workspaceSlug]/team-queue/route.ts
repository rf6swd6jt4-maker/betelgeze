import { parseTeamQueue } from "@/lib/team-queue"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

const headers = { "Cache-Control": "private, no-store" }

/** Other people's ready work for the Today column's Team view. Owners and admins only; read-only. */
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your account changed. Reload the page." }, { status: 409, headers })
    const { data, error } = await supabaseAdmin.rpc("read_team_work_queue", { p_workspace: workspace.id, p_actor: user.id })
    if (error?.code === "PGRST202" || error?.code === "42883") return Response.json({ available: false }, { headers })
    if (error) return Response.json({ error: "Could not load the team's queue." }, { status: 503, headers })
    const queue = parseTeamQueue(data)
    if (!queue) return Response.json({ error: "The team's queue could not be read." }, { status: 503, headers })
    return Response.json({ available: true, ...queue }, { headers })
}
