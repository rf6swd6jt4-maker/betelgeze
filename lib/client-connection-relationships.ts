import "server-only"

import type { ClientConnectionAccount } from "@/lib/client-connections"
import { supabaseAdmin } from "@/lib/supabase/admin"

export type ClientConnectionProvider = "ghl" | "meta_ads" | "google_ads"
export type ClientConnectionRelationshipsPage = { accounts: ClientConnectionAccount[]; nextCursor: string | null }
export class ClientConnectionRelationshipsAccessError extends Error {}

export async function readClientConnectionRelationships(workspaceId: string, userId: string, provider: ClientConnectionProvider, query = "", after?: string, relationshipId?: string): Promise<ClientConnectionRelationshipsPage> {
    const { data, error } = await supabaseAdmin.rpc("read_client_connection_relationships", {
        p_workspace_id: workspaceId, p_user_id: userId, p_provider: provider,
        p_query: query, p_after: after ?? null, p_relationship_id: relationshipId ?? null,
    })
    if (data?.failure === "access") throw new ClientConnectionRelationshipsAccessError("Client connection access changed.")
    if (error || !data || data.failure || !Array.isArray(data.accounts)) throw new Error("Relationships could not be loaded. Try again.")
    return data as ClientConnectionRelationshipsPage
}
