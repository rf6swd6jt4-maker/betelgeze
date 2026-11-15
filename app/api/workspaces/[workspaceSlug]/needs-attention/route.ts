import { parseAttention } from "@/lib/needs-attention"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

const headers = { "Cache-Control": "private, no-store" }

/** Team-wide Needs attention summary for the Today column. Owners and admins only; read-only. */
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your account changed. Reload the page." }, { status: 409, headers })
    const { data, error } = await supabaseAdmin.rpc("workspace_needs_attention", { p_workspace: workspace.id, p_actor: user.id })
    if (error?.code === "PGRST202" || error?.code === "42883") return Response.json({ available: false }, { headers })
    if (error) return Response.json({ error: "Could not load what needs attention." }, { status: 503, headers })
    const groups = parseAttention(data)
    if (!groups) return Response.json({ error: "What needs attention could not be read." }, { status: 503, headers })
    return Response.json({ available: true, groups }, { headers })
}
