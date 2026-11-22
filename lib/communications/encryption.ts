import { createSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function createCommunicationFileKey(input: {
    workspaceId: string
    scopeKind: "client" | "native"
    scopeId: string
    storagePath: string
}) {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc("communication_create_file_key", {
        p_workspace_id: input.workspaceId,
        p_scope_kind: input.scopeKind,
        p_scope_id: input.scopeId,
        p_storage_path: input.storagePath,
    })
    if (error || typeof data !== "string" || !data) throw new Error(error?.message ?? "Could not create the attachment encryption key.")
    return data
}

export async function createInboundCommunicationFileKey(input: {
    workspaceId: string
    relationshipId: string
    storagePath: string
}) {
    const { data, error } = await supabaseAdmin.rpc("communication_create_inbound_file_key", {
        p_workspace_id: input.workspaceId,
        p_relationship_id: input.relationshipId,
        p_storage_path: input.storagePath,
    })
    if (error || typeof data !== "string" || !data) throw new Error(error?.message ?? "Could not create the inbound attachment encryption key.")
    return data
}

/** A lead conversation's file key, made by the server for a flow text's picture (docs/text-flows.md). */
export async function createLeadConversationFileKey(input: { workspaceId: string; conversationId: string; storagePath: string; createdBy: string | null }) {
    const { data, error } = await supabaseAdmin.rpc("campaign_lead_file_key", {
        p_workspace_id: input.workspaceId, p_conversation_id: input.conversationId, p_storage_path: input.storagePath, p_created_by: input.createdBy,
    })
    if (error || typeof data !== "string" || !data) throw new Error(error?.message ?? "Could not create the picture's encryption key.")
    return data
}

export async function communicationFileKeyForCurrentUser(storagePath: string) {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc("communication_file_key_for_user", { p_storage_path: storagePath })
    if (error) throw new Error(error.message)
    return typeof data === "string" && data ? data : null
}

export async function createCommunicationMediaGrant(storagePath: string) {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc("communication_create_media_grant", { p_storage_path: storagePath })
    if (error) throw new Error(error.message)
    return typeof data === "string" && data ? data : null
}

export async function redeemCommunicationMediaGrant(storagePath: string, token: string) {
    const { data, error } = await supabaseAdmin.rpc("communication_redeem_media_grant", {
        p_storage_path: storagePath,
        p_token: token,
    })
    if (error) throw new Error(error.message)
    return typeof data === "string" && data ? data : null
}
