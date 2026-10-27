import "server-only"

import { supabaseAdmin } from "@/lib/supabase/admin"

export type AdvertisingProvider = "google_ads" | "meta_ads" | "windsor"
export type AdvertisingConnectionCursor = { relationshipId: string; provider: AdvertisingProvider }
export type ClientAdvertisingConnection = {
    relationshipId: string
    provider: AdvertisingProvider
    clientName: string
    businessName: string | null
    archived: boolean
    status: "connected" | "pending" | "needs_attention" | "revoked"
    accountId: string | null
    accountName: string | null
    connectedAt: string | null
    verifiedAt: string | null
}
export type AdvertisingConnectionsPage = { accounts: ClientAdvertisingConnection[]; nextCursor: AdvertisingConnectionCursor | null }

export class AdvertisingConnectionAccessError extends Error {}

export async function readClientAdvertisingConnections(workspaceId: string, userId: string, relationshipId?: string, cursor?: AdvertisingConnectionCursor): Promise<AdvertisingConnectionsPage> {
    const { data, error } = await supabaseAdmin.rpc("read_client_advertising_connections", {
        p_workspace_id: workspaceId, p_user_id: userId, p_relationship_id: relationshipId ?? null,
        p_after_relationship: cursor?.relationshipId ?? null, p_after_provider: cursor?.provider ?? null,
    })
    if (data?.failure === "access") throw new AdvertisingConnectionAccessError("Client connection access changed.")
    if (error || !data || data.failure || !Array.isArray(data.accounts)) throw new Error("Advertising connections could not be loaded. Try again.")
    return data as AdvertisingConnectionsPage
}
