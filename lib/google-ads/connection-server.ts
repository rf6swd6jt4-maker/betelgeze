import { randomUUID } from "node:crypto"
import { connectGoogleAdsClient, googleAdsClientError, googleAdsDiagnosticError, normalizeGoogleAdsConfig } from "@/lib/google-ads"
import { googleAdsOnboardingResponse, normalizeGoogleAdsCustomerId } from "@/lib/onboarding/google-ads-state"
import { decryptWorkspaceIntegration } from "@/lib/workspace-integrations"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function runGoogleAdsConnection(integration: { config_encrypted: string }, scope: { token: string; blockId: string } | { token: string; workspaceId: string }, rawCustomerId: string, sendRequest: boolean, runner: typeof connectGoogleAdsClient = connectGoogleAdsClient) {
    const customerId = normalizeGoogleAdsCustomerId(rawCustomerId)
    let config
    try { config = normalizeGoogleAdsConfig(decryptWorkspaceIntegration(integration.config_encrypted)) }
    catch { throw new Error("Your agency’s Google Ads connection needs attention. Contact your agency to continue.") }
    const onboarding = "blockId" in scope
    const params = { p_token: scope.token, ...(onboarding ? { p_block_id: scope.blockId } : { p_workspace_id: scope.workspaceId }) }
    const attemptId = randomUUID()
    const { error: beginError } = await supabaseAdmin.rpc(onboarding ? "begin_google_ads_onboarding" : "begin_google_ads_portal", {
        ...params, p_customer_id: customerId, p_manager_id: config.manager_customer_id, p_attempt_id: attemptId,
    })
    if (beginError) throw new Error(beginError.code === "P0001" || beginError.code === "22023" ? beginError.message : "The connection could not be prepared. Please try again.")
    let result: Awaited<ReturnType<typeof connectGoogleAdsClient>> | null = null
    let message: string | null = null, diagnostic: string | null = null
    try {
        const budget = AbortSignal.timeout(50_000)
        result = await runner(config, customerId, sendRequest, (url, init) => fetch(url, { ...init, signal: AbortSignal.any([budget, init?.signal ?? budget]) }))
    }
    catch (error) { message = googleAdsClientError(error); diagnostic = googleAdsDiagnosticError(error) }
    const { data, error: finishError } = await supabaseAdmin.rpc(onboarding ? "finish_google_ads_onboarding" : "finish_google_ads_portal", {
        ...params, p_attempt_id: attemptId, p_expected_config: integration.config_encrypted,
        p_status: result?.status ?? "needs_attention", p_account_name: result?.status === "connected" ? result.accountName : null,
        p_currency: result?.status === "connected" ? result.currency : null, p_timezone: result?.status === "connected" ? result.timeZone : null, p_error: diagnostic,
    })
    if (finishError) throw new Error(finishError.code === "P0001" ? finishError.message : "Google responded, but the connection could not be saved. Please check again.")
    if (message) throw new Error(message)
    const connection = googleAdsOnboardingResponse(data)
    if (!connection) throw new Error("The saved connection could not be confirmed. Please check again.")
    return connection
}
