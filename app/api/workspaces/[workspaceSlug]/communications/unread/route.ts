import { withChatPerformance } from "@/lib/communications/performance-server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireCommunicationsWorkspace } from "@/lib/communications/workspace-access"

export const dynamic = "force-dynamic"

async function handleGET(_request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace } = await requireCommunicationsWorkspace(workspaceSlug)
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc("communication_unread_summary", { p_workspace_id: workspace.id })
    if (error) return Response.json({ error: "Unread counts are unavailable." }, { status: 503 })
    return Response.json({ conversations: data }, { headers: { "Cache-Control": "private, no-store" } })
}

export const GET = withChatPerformance("message.unread", handleGET)
