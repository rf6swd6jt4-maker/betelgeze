import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { checkboxInput, checklistResponseError, updateChatCheckbox } from "@/lib/communications/checklists"

export const runtime = "nodejs"
export async function PATCH(request: Request, context: { params: Promise<{ token: string }> }) {
    const { token } = await context.params
    const resolved = await resolveClientPortalAccessByToken(token)
    if (!resolved) return Response.json({ error: "Portal not found." }, { status: 404 })
    const input = checkboxInput(await request.json().catch(() => null))
    if (!input) return Response.json({ error: "Choose a valid checklist item." }, { status: 400 })
    try {
        const result = await updateChatCheckbox({ ...input, workspaceId: resolved.workspace.id, scopeId: resolved.relationship.id, kind: "client", portalSessionId: resolved.session.id, loadBody: async (createdAt) => {
            // Start the encrypted projection at the target's timestamp so older
            // loaded history can be checked without scanning the latest page.
            const messages = await supabaseAdmin.rpc("client_portal_messages_v2", {
                p_workspace_id: resolved.workspace.id, p_relationship_id: resolved.relationship.id,
                p_before: new Date(Date.parse(createdAt) + 1).toISOString(), p_limit: 200,
            }).eq("id", input.messageId)
            if (messages.error) throw new Error("Could not load checklist.")
            const message = messages.data?.[0]
            return typeof message?.body === "string" ? message.body : null
        } })
        return Response.json(result, { headers: { "Cache-Control": "private, no-store" } })
    } catch (error) { return checklistResponseError(error) }
}
