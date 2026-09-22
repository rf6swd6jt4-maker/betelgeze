import "server-only"

import { randomUUID } from "node:crypto"
import { fetchGhlMetrics, GhlError, parseGhlCredentials } from "@/lib/client-portal/ghl-provider"
import { getWorkspaceProviderConfig } from "@/lib/workspace-integrations"
import { supabaseAdmin } from "@/lib/supabase/admin"

export type ClientConnectionAccount = {
    relationshipId: string
    clientName: string
    businessName: string | null
    accountType: "client_account" | "agency_subaccount"
    connected: boolean
    locationId: string | null
    locationName: string | null
    refreshedAt: string | null
    readyAt: string | null
    error: string | null
    busy: boolean
}

const failureMessages: Record<string, string> = {
    access: "You do not have access to this client connection.", busy: "This client connection is already being updated.",
    cooldown: "Wait a few seconds before trying again.", changed: "The connection changed while it was being verified. Reload and try again.",
    credentials: "HighLevel rejected these credentials.", permissions: "The HighLevel token does not have the required read permissions.",
    location: "HighLevel could not find that Location ID.", rate_limit: "HighLevel is temporarily rate limiting requests.",
    response: "HighLevel returned an unexpected response.", duplicate: "That HighLevel location is already linked to another client.",
    agency: "That location does not belong to the connected agency.", unavailable: "HighLevel could not be reached.", storage: "The connection could not be saved.",
}

async function call(workspaceId: string, userId: string, action: string, params: Record<string, unknown> = {}) {
    const { data, error } = await supabaseAdmin.rpc("manage_client_ghl_connection", { p_workspace_id: workspaceId, p_user_id: userId, p_action: action, ...params })
    if (error || !data || typeof data !== "object") throw new GhlError("storage")
    if (!Array.isArray(data) && typeof (data as Record<string, unknown>).failure === "string") throw new GhlError(String((data as Record<string, unknown>).failure))
    return data
}

export async function listClientConnections(workspaceId: string, userId: string): Promise<ClientConnectionAccount[]> {
    const data = await call(workspaceId, userId, "list")
    if (!Array.isArray(data)) throw new Error("Client connections could not be loaded.")
    return data.flatMap((value): ClientConnectionAccount[] => {
        if (!value || typeof value !== "object") return []
        const row = value as Record<string, unknown>
        if (typeof row.relationshipId !== "string" || typeof row.clientName !== "string") return []
        return [{
            relationshipId: row.relationshipId, clientName: row.clientName,
            businessName: typeof row.businessName === "string" ? row.businessName : null,
            accountType: row.accountType === "agency_subaccount" ? "agency_subaccount" : "client_account",
            connected: row.connected === true, locationId: typeof row.locationId === "string" ? row.locationId : null,
            locationName: typeof row.locationName === "string" ? row.locationName : null,
            refreshedAt: typeof row.refreshedAt === "string" ? row.refreshedAt : null,
            readyAt: typeof row.readyAt === "string" ? row.readyAt : null,
            error: typeof row.error === "string" ? row.error : null, busy: row.busy === true,
        }]
    })
}

export async function connectClientHighLevel(input: { workspaceId: string; userId: string; relationshipId: string; accountType: "client_account" | "agency_subaccount"; locationId: string; privateToken: string }) {
    const credentials = parseGhlCredentials(input)
    if (!credentials) throw new Error("Enter a valid Location ID and Private Integration Token.")
    const operationId = randomUUID()
    try {
        await call(input.workspaceId, input.userId, "begin_connect", { p_relationship_id: input.relationshipId, p_operation_id: operationId })
        const result = await fetchGhlMetrics(credentials)
        if (input.accountType === "agency_subaccount") {
            const agency = await getWorkspaceProviderConfig(input.workspaceId, "ghl")
            if (!result.companyId || result.companyId !== agency.company_id) throw new GhlError("agency")
        }
        await call(input.workspaceId, input.userId, "finish", { p_relationship_id: input.relationshipId, p_operation_id: operationId, p_account_type: input.accountType, p_location_id: credentials.locationId, p_private_token: credentials.privateToken, p_location_name: result.locationName, p_metrics: result.metrics })
    } catch (error) {
        const code = error instanceof GhlError ? error.code : "unavailable"
        await call(input.workspaceId, input.userId, "fail", { p_relationship_id: input.relationshipId, p_operation_id: operationId, p_error: code }).catch(() => {})
        throw new Error(failureMessages[code] ?? "The HighLevel connection could not be verified.")
    }
}

export async function refreshClientHighLevel(input: { workspaceId: string; userId: string; relationshipId: string }) {
    const operationId = randomUUID()
    try {
        const started = await call(input.workspaceId, input.userId, "begin_refresh", { p_relationship_id: input.relationshipId, p_operation_id: operationId }) as Record<string, unknown>
        const credentials = parseGhlCredentials(started)
        if (!credentials) throw new GhlError("credentials")
        const accountType = started.accountType === "agency_subaccount" ? "agency_subaccount" : "client_account"
        const result = await fetchGhlMetrics(credentials)
        if (accountType === "agency_subaccount") {
            const agency = await getWorkspaceProviderConfig(input.workspaceId, "ghl")
            if (!result.companyId || result.companyId !== agency.company_id) throw new GhlError("agency")
        }
        await call(input.workspaceId, input.userId, "finish", { p_relationship_id: input.relationshipId, p_operation_id: operationId, p_account_type: accountType, p_location_id: credentials.locationId, p_private_token: null, p_location_name: result.locationName, p_metrics: result.metrics })
    } catch (error) {
        const code = error instanceof GhlError ? error.code : "unavailable"
        await call(input.workspaceId, input.userId, "fail", { p_relationship_id: input.relationshipId, p_operation_id: operationId, p_error: code }).catch(() => {})
        throw new Error(failureMessages[code] ?? "The HighLevel connection could not be refreshed.")
    }
}
