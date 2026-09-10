import "server-only"

import { createHash } from "node:crypto"
import { resolvePrimaryMessagingProvider } from "@/lib/client-messages/addresses"
import { parseRelationshipBackgroundCommand, type RelationshipBackgroundCommand, type RelationshipBackgroundResult } from "@/lib/relationship-draft-command"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireRelationshipAccess, requireWorkspaceAccess } from "@/lib/workspace-access"

export async function saveRelationshipBackgroundCommand(workspaceSlug: string, relationshipId: string, input: RelationshipBackgroundCommand): Promise<RelationshipBackgroundResult> {
    const command = parseRelationshipBackgroundCommand(input)
    if (!command) return { ok: false, error: "Invalid relationship changes." }
    const { workspace, user, access } = await requireWorkspaceAccess(workspaceSlug)
    await requireRelationshipAccess(access, relationshipId)
    if (command.expectedUserId !== user.id) return { ok: false, error: "Your account changed. Reopen this relationship with the original account before saving." }
    const values = Object.fromEntries(Object.entries(command.values).map(([key, value]) => [key, value.trim()])) as typeof command.values
    if (!values.primaryPersonName) return { ok: false, error: "Add the client's name before saving the relationship" }
    values.communicationPrimaryProvider = resolvePrimaryMessagingProvider({ requestedProvider: values.communicationPrimaryProvider, smsPhone: values.primaryPhone, whatsappPhone: values.whatsappPhone })
    const requestHash = createHash("sha256").update(JSON.stringify({ expectedUpdatedAt: command.expectedUpdatedAt, values: command.values })).digest("hex")
    const { data, error } = await supabaseAdmin.rpc("save_relationship_background_command", {
        p_workspace_id: workspace.id, p_relationship_id: relationshipId, p_user_id: user.id,
        p_expected_updated_at: command.expectedUpdatedAt, p_request_id: command.requestId, p_request_hash: requestHash, p_values: values,
    })
    if (error) {
        if (error.code === "42501") return { ok: false, error: "Only this relationship's seller, manager or a workspace admin can update its details." }
        if (error.code === "P0002") return { ok: false, error: "The relationship could not be found." }
        if (error.code === "22023") return { ok: false, error: "That save request could not be verified. Review your relationship draft before retrying." }
        if (["23514", "22001", "22P02"].includes(error.code)) return { ok: false, error: "The relationship values could not be accepted. Review your draft before saving again." }
        // Never switch transport or invent a new request after an uncertain
        // response: the caller retains this identity until its receipt resolves.
        throw new Error("The relationship save could not be confirmed. Your draft is preserved for retry.")
    }
    if (!data || typeof data.ok !== "boolean") throw new Error("The relationship save could not be confirmed. Retry your preserved draft.")
    return data as RelationshipBackgroundResult
}
