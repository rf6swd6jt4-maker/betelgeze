import "server-only"

import { supabaseAdmin } from "@/lib/supabase/admin"
import { GoogleAdsConnectionAccessError, runGoogleAdsConnection } from "@/lib/google-ads/connection-server"
import { googleAdsOnboardingResponse } from "@/lib/onboarding/google-ads-state"

export class StaffGoogleAdsUnavailableError extends Error {}

export type StaffGoogleAdsIdentity = { workspaceId: string; relationshipId: string; userId: string }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

async function read(identity: StaffGoogleAdsIdentity, credentials: boolean) {
    if (![identity.workspaceId, identity.relationshipId, identity.userId].every(value => uuid.test(value))) throw new Error("Choose a valid client relationship.")
    const { data, error } = await supabaseAdmin.rpc("read_google_ads_staff", {
        p_workspace_id: identity.workspaceId, p_user_id: identity.userId, p_relationship_id: identity.relationshipId, p_credentials: credentials,
    })
    if (error?.code === "42501") throw new GoogleAdsConnectionAccessError(error.message)
    if (error || !data || typeof data !== "object") throw new Error(error && ["P0001", "42501"].includes(error.code) ? error.message : "Google Ads could not be loaded. Please retry.")
    return data as Record<string, unknown>
}

export async function loadStaffGoogleAds(identity: StaffGoogleAdsIdentity) {
    const data = await read(identity, false)
    if (typeof data.error === "string") throw new StaffGoogleAdsUnavailableError(data.error)
    const connection = googleAdsOnboardingResponse(data.connection)
    // Only the credential-free projection can cross the staff HTTP boundary.
    return {
        connection, managerId: typeof data.managerId === "string" ? data.managerId : "",
        managerName: typeof data.managerName === "string" ? data.managerName : "Your agency",
        satisfied: connection?.status === "connected",
    }
}

export async function runStaffGoogleAds(identity: StaffGoogleAdsIdentity, customerId: string, sendRequest: boolean) {
    const data = await read(identity, true)
    if (typeof data.integrationEncrypted !== "string" || !data.integrationEncrypted) throw new StaffGoogleAdsUnavailableError(typeof data.error === "string" ? data.error : "Connect the agency Google Ads manager account in Settings first.")
    return runGoogleAdsConnection({ config_encrypted: data.integrationEncrypted }, identity, customerId, sendRequest)
}
