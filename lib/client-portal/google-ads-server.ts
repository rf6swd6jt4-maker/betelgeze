import { randomUUID } from "node:crypto"
import { resolveClientPortalAccessByToken } from "./session"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { googleAdsOnboardingResponse } from "@/lib/onboarding/google-ads-state"
import { runGoogleAdsConnection } from "@/lib/google-ads/connection-server"
import { fetchGoogleAdsReport, googleAdsClientError } from "@/lib/google-ads"
import { decryptWorkspaceIntegration } from "@/lib/workspace-integrations"
import { isGoogleAdsPeriod, type GoogleAdsReportSnapshot } from "@/lib/google-ads-report"

export async function portalGoogleAdsContext(token: string) {
    const access = await resolveClientPortalAccessByToken(token)
    if (!access) throw new Error("This client portal is unavailable. Please reopen your portal link.")
    const { data: integration, error } = await supabaseAdmin.from("workspace_integrations")
        .select("enabled, mode, connected_account_id, config_hint, config_encrypted")
        .eq("workspace_id", access.workspace.id).eq("provider", "google_ads").maybeSingle()
    if (error) throw new Error("The Google Ads connection could not be loaded. Please try again.")
    const ready = integration?.enabled && integration.mode === "connected" && integration.connected_account_id && integration.config_encrypted
    return { access, integration: ready ? integration! : null }
}
export async function loadPortalGoogleAds(token: string) {
    const { access, integration } = await portalGoogleAdsContext(token)
    if (!integration) return { connection: null, managerId: "", managerName: access.workspace.name, satisfied: false, error: "Your agency needs to connect its Google Ads manager account before you can continue." }
    const { data, error } = await supabaseAdmin.from("relationship_google_ads_connections")
        .select("customer_id, manager_customer_id, status, account_name, last_verified_at")
        .eq("workspace_id", access.workspace.id).eq("relationship_id", access.relationship.id).maybeSingle()
    if (error) throw new Error("The saved account could not be loaded. Please retry.")
    const managerName = String(integration.config_hint?.manager_name || access.workspace.name), managerId = String(integration.connected_account_id)
    const matches = data?.manager_customer_id === managerId
    const connection = data ? googleAdsOnboardingResponse({ customerId: data.customer_id, managerId, managerName, status: matches ? data.status : "needs_attention", accountName: matches ? data.account_name : null, verifiedAt: matches ? data.last_verified_at : null }) : null
    return { connection, managerName, managerId, satisfied: connection?.status === "connected" }
}
export async function runPortalGoogleAds(token: string, customerId: string, sendRequest: boolean) {
    const { access, integration } = await portalGoogleAdsContext(token)
    if (!integration) throw new Error("Your agency needs to connect its Google Ads manager account first.")
    return runGoogleAdsConnection(integration, { token, workspaceId: access.workspace.id }, customerId, sendRequest)
}
export async function portalGoogleAdsReport(token: string, period: unknown, refresh: boolean) {
    if (!isGoogleAdsPeriod(period)) throw new Error("Choose a reporting period.")
    const access = await resolveClientPortalAccessByToken(token)
    if (!access) throw new Error("This client portal is unavailable. Please reopen your portal link.")
    const call = async (action: string, params: Record<string, unknown> = {}) => {
        const { data, error } = await supabaseAdmin.rpc("client_portal_google_ads_report", { p_token: token, p_workspace_id: access.workspace.id, p_period: period, p_action: action, ...params })
        if (error) throw new Error(error.code === "P0001" ? error.message : "The report could not be loaded or saved. Please retry.")
        return data as { snapshot?: GoogleAdsReportSnapshot | null; error?: string | null; busy?: boolean; customerId?: string; configEncrypted?: string }
    }
    let data
    if (!refresh) data = await call("read")
    else {
        const operation = randomUUID(), started = await call("begin", { p_operation_id: operation })
        const params = { p_operation_id: operation, p_expected_config: started.configEncrypted }
        try {
            if (!started.customerId || !started.configEncrypted) throw new Error("Reconnect Google Ads before refreshing.")
            const budget = AbortSignal.timeout(50_000)
            const report = await fetchGoogleAdsReport(decryptWorkspaceIntegration(started.configEncrypted), started.customerId, period, (url, init) => fetch(url, { ...init, signal: AbortSignal.any([budget, init?.signal ?? budget]) }))
            data = await call("finish", { ...params, p_report: report })
        } catch (error) {
            const message = googleAdsClientError(error)
            await call("fail", { ...params, p_error: message }).catch(() => {})
            throw new Error(message)
        }
    }
    // Never return the begin-operation credential payload.
    return { snapshot: data.snapshot ?? null, error: data.error ?? null, busy: data.busy === true }
}

export async function disconnectPortalGoogleAds(token: string) {
    const access = await resolveClientPortalAccessByToken(token)
    if (!access) throw new Error("This client portal is unavailable. Please reopen your portal link.")
    const { error } = await supabaseAdmin.rpc("disconnect_google_ads_portal", { p_token: token, p_workspace_id: access.workspace.id })
    if (error) throw new Error(error.code === "P0001" ? error.message : "Google Ads could not be disconnected. Please retry.")
    return { connection: null, satisfied: false }
}
