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

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const LOAD_ERROR = "Advertising connections could not be loaded. Try again."
const nullableString = (value: unknown): value is string | null => value === null || typeof value === "string"
const nullableTimestamp = (value: unknown): value is string | null => value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)))

function decodeConnection(value: unknown): ClientAdvertisingConnection {
    // This compact private RPC tuple is decoded here, never exposed to the UI.
    if (!Array.isArray(value) || value.length !== 9) throw new Error(LOAD_ERROR)
    const [relationshipId, provider, clientName, businessName, status, accountId, accountName, connectedAt, verifiedAt] = value
    if (typeof relationshipId !== "string" || !UUID.test(relationshipId)
        || !["google_ads", "meta_ads", "windsor"].includes(provider)
        || typeof clientName !== "string" || !nullableString(businessName)
        || !["connected", "pending", "needs_attention", "revoked"].includes(status)
        || !nullableString(accountId) || !nullableString(accountName)
        || !nullableTimestamp(connectedAt) || !nullableTimestamp(verifiedAt)) throw new Error(LOAD_ERROR)
    return { relationshipId: relationshipId.toLowerCase(), provider, clientName, businessName, archived: false, status, accountId, accountName, connectedAt, verifiedAt }
}

function compareConnection(left: AdvertisingConnectionCursor, right: AdvertisingConnectionCursor) {
    const leftId = left.relationshipId.toLowerCase(), rightId = right.relationshipId.toLowerCase()
    return leftId === rightId ? (left.provider < right.provider ? -1 : left.provider === right.provider ? 0 : 1) : leftId < rightId ? -1 : 1
}

export async function readClientAdvertisingConnections(workspaceId: string, userId: string, relationshipId?: string, cursor?: AdvertisingConnectionCursor): Promise<AdvertisingConnectionsPage> {
    const { data, error } = await supabaseAdmin.rpc("read_current_client_advertising_connections", {
        p_workspace_id: workspaceId, p_user_id: userId, p_relationship_id: relationshipId ?? null,
        p_after_relationship: cursor?.relationshipId ?? null, p_after_provider: cursor?.provider ?? null,
    })
    if (data?.failure === "access") throw new AdvertisingConnectionAccessError("Client connection access changed.")
    if (error || !Array.isArray(data) || data.length > 51) throw new Error(LOAD_ERROR)
    const decoded = data.map(decodeConnection)
    for (let index = 0; index < decoded.length; index++) {
        const row = decoded[index], preceding = index ? decoded[index - 1] : cursor
        if ((relationshipId && row.relationshipId !== relationshipId.toLowerCase()) || (preceding && compareConnection(preceding, row) >= 0)) throw new Error(LOAD_ERROR)
    }
    const accounts = decoded.slice(0, 50)
    const last = accounts[49]
    return { accounts, nextCursor: decoded.length === 51 ? { relationshipId: last.relationshipId, provider: last.provider } : null }
}
