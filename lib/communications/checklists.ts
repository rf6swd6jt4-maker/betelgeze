import "server-only"

import { chatCheckboxBody, sameChatChecklist } from "@/lib/chat-formatting"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { recordAdminActivity } from "@/lib/admin/activity"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function checkboxInput(value: unknown) {
    const input = value && typeof value === "object" ? value as Record<string, unknown> : {}
    if (typeof input.messageId !== "string" || !UUID.test(input.messageId) || !Number.isInteger(input.line) || Number(input.line) < 0 || Number(input.line) > 4000 || typeof input.checked !== "boolean" || typeof input.expectedBody !== "string" || input.expectedBody.length > 8000) return null
    if (chatCheckboxBody(input.expectedBody, Number(input.line), input.checked) === null) return null
    return { messageId: input.messageId, line: Number(input.line), checked: input.checked, expectedBody: input.expectedBody }
}
export function validChatId(value: unknown): value is string { return typeof value === "string" && UUID.test(value) }
export class ChecklistError extends Error {
    status: number
    constructor(message: string, status = 503) { super(message); this.status = status }
}

// Routes authorize the actor and conversation first. Compare-and-swap on the
// stored ciphertext then protects against concurrent checklist changes or edits.
// Only body is written; the existing database trigger encrypts it again.
export async function updateChatCheckbox(input: NonNullable<ReturnType<typeof checkboxInput>> & {
    workspaceId: string
    scopeId: string
    kind: "client" | "native"
    actorUserId?: string
    portalSessionId?: string
    loadBody: (createdAt: string) => Promise<string | null>
}) {
    const table = input.kind === "native" ? "workspace_native_messages" : "client_messages"
    const scopeColumn = input.kind === "native" ? "conversation_id" : "relationship_id"
    for (let attempt = 0; attempt < 3; attempt++) {
        const snapshot = await supabaseAdmin.from(table).select("id, body, body_ciphertext, created_at")
            .eq("workspace_id", input.workspaceId).eq(scopeColumn, input.scopeId).eq("id", input.messageId).maybeSingle()
        if (snapshot.error) throw new ChecklistError("Could not load this checklist.")
        if (!snapshot.data) throw new ChecklistError("Message not found.", 404)
        const body = await input.loadBody(snapshot.data.created_at)
        if (body === null) throw new ChecklistError("Message not found.", 404)
        if (!sameChatChecklist(body, input.expectedBody)) throw new ChecklistError("This checklist was edited. Refresh the chat and try again.", 409)
        const nextBody = chatCheckboxBody(body, input.line, input.checked)
        if (nextBody === null) throw new ChecklistError("Checklist item not found.", 409)
        if (nextBody === body) return { body }
        let update = supabaseAdmin.from(table).update({ body: nextBody })
            .eq("workspace_id", input.workspaceId).eq(scopeColumn, input.scopeId).eq("id", input.messageId)
        update = snapshot.data.body_ciphertext === null
            ? update.is("body_ciphertext", null).eq("body", snapshot.data.body)
            : update.eq("body_ciphertext", snapshot.data.body_ciphertext)
        const saved = await update.select("id").maybeSingle()
        if (saved.error) throw new ChecklistError("Could not save this checkbox. Try again.")
        if (!saved.data) continue
        await recordAdminActivity({
            workspaceId: input.workspaceId, category: "communications", eventKey: "chat.checkbox.changed",
            summary: input.checked ? "Chat checklist item checked" : "Chat checklist item unchecked",
            entityType: table, entityId: input.messageId, actorUserId: input.actorUserId ?? null,
            actorKind: input.portalSessionId ? "client" : "staff", metricClassification: "audit",
            metadata: { conversation_id: input.scopeId, line: input.line, checked: input.checked, portal_session_id: input.portalSessionId ?? null },
        })
        return { body: nextBody }
    }
    throw new ChecklistError("This checklist changed while saving. Try again.", 409)
}
export function checklistResponseError(error: unknown) {
    return Response.json({ error: error instanceof ChecklistError ? error.message : "Could not update this checklist." }, { status: error instanceof ChecklistError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } })
}
