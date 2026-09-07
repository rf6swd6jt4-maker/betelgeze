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
        await updateChatCheckbox({ ...input, workspaceId: workspace.id, scopeId: conversationId, kind: "native", actorUserId: user.id, loadBody: async () => {
            const message = await loadNativeMessageForCurrentUser({ workspaceId: workspace.id, messageId: input.messageId })
            return message && message.conversationId === conversationId ? message.body : null
        } })
        const message = await loadNativeMessageForCurrentUser({ workspaceId: workspace.id, messageId: input.messageId })
        return Response.json({ message }, { headers: { "Cache-Control": "private, no-store" } })
    } catch (error) { return checklistResponseError(error) }
}
