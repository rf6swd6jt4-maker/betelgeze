import { requireWorkspacePanel } from "@/lib/workspace-access"
import { assertNativeConversationAccess, loadNativeMessageForCurrentUser } from "@/lib/teams/server"
import { checkboxInput, checklistResponseError, updateChatCheckbox, validChatId } from "@/lib/communications/checklists"

export const runtime = "nodejs"
export async function PATCH(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const raw = await request.json().catch(() => null)
    const input = checkboxInput(raw)
    if (!input || !validChatId(raw?.conversationId)) return Response.json({ error: "Choose a valid checklist item." }, { status: 400 })
    const conversationId = raw.conversationId
    if (!await assertNativeConversationAccess(conversationId, user.id, "write")) return Response.json({ error: "Conversation is unavailable or read-only." }, { status: 403 })
    try {
        const loaded = { message: null as Awaited<ReturnType<typeof loadNativeMessageForCurrentUser>> }
        const result = await updateChatCheckbox({ ...input, workspaceId: workspace.id, scopeId: conversationId, kind: "native", actorUserId: user.id, loadBody: async () => {
            const message = await loadNativeMessageForCurrentUser({ workspaceId: workspace.id, messageId: input.messageId })
            loaded.message = message && message.conversationId === conversationId ? message : null
            return message && message.conversationId === conversationId ? message.body : null
        } })
        // A successful save must not depend on a second message reload. Keep
        // the message envelope for already-open clients using the older API.
        return Response.json({ ...result, message: loaded.message ? { ...loaded.message, body: result.body } : null }, { headers: { "Cache-Control": "private, no-store" } })
    } catch (error) { return checklistResponseError(error) }
}
