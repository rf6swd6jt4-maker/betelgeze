import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"

const uuid = (value: string | null) => Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))

export async function GET(request: Request, { params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const disputeId = new URL(request.url).searchParams.get("dispute")
    if (!uuid(disputeId)) return Response.redirect(new URL(`/${workspace.slug}/queue`, request.url))
    const result = await supabaseAdmin.rpc("read_queue_dispute", { p_workspace: workspace.id, p_user: user.id, p_dispute: disputeId })
    if (result.error || !result.data?.conversation_id) return Response.redirect(new URL(`/${workspace.slug}/queue`, request.url))
    return Response.redirect(new URL(`/${workspace.slug}/communications?conversation=${encodeURIComponent(result.data.conversation_id)}`, request.url))
}
