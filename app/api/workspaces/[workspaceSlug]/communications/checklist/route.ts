import { clientConversationCanAccess } from "@/lib/communications/access"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { loadCommunicationMessage } from "@/lib/communications/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { checkboxInput, checklistResponseError, updateChatCheckbox, validChatId } from "@/lib/communications/checklists"

export const runtime = "nodejs"
export async function PATCH(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const raw = await request.json().catch(() => null)
    const input = checkboxInput(raw)
    if (!input || !validChatId(raw?.relationshipId)) return Response.json({ error: "Choose a valid checklist item." }, { status: 400 })
    const relationshipId = raw.relationshipId
    if (!/^[0-9a-f-]{36}$/i.test(relationshipId) || !await clientConversationCanAccess(workspace.id, relationshipId, user.id)) return Response.json({ error: "Conversation not found." }, { status: 404 })
    const relationship = await supabaseAdmin.from("relationships").select("id").eq("workspace_id", workspace.id).eq("id", relationshipId).neq("status", "archived").maybeSingle()
    if (relationship.error) return Response.json({ error: "Could not verify conversation access." }, { status: 503 })
    if (!relationship.data) return Response.json({ error: "Conversation not found." }, { status: 404 })
    try {
        const loaded = { message: null as Awaited<ReturnType<typeof loadCommunicationMessage>> }
        const result = await updateChatCheckbox({ ...input, workspaceId: workspace.id, scopeId: relationshipId, kind: "client", actorUserId: user.id, loadBody: async () => {
            const message = await loadCommunicationMessage({ workspaceId: workspace.id, messageId: input.messageId })
            loaded.message = message && message.relationshipId === relationshipId ? message : null
            return message && message.relationshipId === relationshipId ? message.body : null
        } })
        return Response.json({ ...result, message: loaded.message ? { ...loaded.message, body: result.body } : null }, { headers: { "Cache-Control": "private, no-store" } })
    } catch (error) { return checklistResponseError(error) }
}
