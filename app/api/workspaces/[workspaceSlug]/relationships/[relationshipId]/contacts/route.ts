import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"
import { readRelationshipContacts } from "@/lib/relationship-contacts-server"
import { supabaseAdmin } from "@/lib/supabase/admin"
export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }
export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string; relationshipId: string }> }) {
    const { workspaceSlug, relationshipId } = await context.params
    const { workspace, user, access } = await requireWorkspacePanel(workspaceSlug, "relationships")
    await requireRelationshipAccess(access, relationshipId)
    if (request.headers.get("x-workspace-user") !== user.id) return Response.json({ error: "Your account changed. Reload this relationship." }, { status: 409, headers })
    const method = new URL(request.url).searchParams.get("method")
    if (method && ["meta_whatsapp", "twilio_sms"].includes(method)) {
        const [message, delivery] = await Promise.all([
            supabaseAdmin.from("client_messages").select("created_at,direction,status").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("provider", method).order("created_at", { ascending: false }).limit(1).maybeSingle(),
            supabaseAdmin.from("communication_message_deliveries").select("created_at,status").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).eq("provider", method).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        ])
        if (message.error || delivery.error) return Response.json({ error: "Last message information is unavailable." }, { status: 503, headers })
        const latest = delivery.data && (!message.data || delivery.data.created_at >= message.data.created_at) ? { ...delivery.data, direction: "outbound" } : message.data
        return Response.json({ latest }, { headers })
    }
    try { return Response.json(await readRelationshipContacts(workspace.id, relationshipId, user.id), { headers }) }
    catch { return Response.json({ error: "Could not check contact connections. Retry when connected." }, { status: 503, headers }) }
}
