import { randomUUID } from "node:crypto"
import { connectGoogleAdsClient, googleAdsClientError, googleAdsDiagnosticError, normalizeGoogleAdsConfig } from "@/lib/google-ads"
import { googleAdsOnboardingResponse, normalizeGoogleAdsCustomerId } from "@/lib/onboarding/google-ads-state"
import { decryptWorkspaceIntegration } from "@/lib/workspace-integrations"
import { supabaseAdmin } from "@/lib/supabase/admin"

export class GoogleAdsConnectionAccessError extends Error {}

export type GoogleAdsConnectionScope = { token: string; blockId: string } | { token: string; workspaceId: string } | { workspaceId: string; relationshipId: string; userId: string }

export async function runGoogleAdsConnection(integration: { config_encrypted: string }, scope: GoogleAdsConnectionScope, rawCustomerId: string, sendRequest: boolean, runner: typeof connectGoogleAdsClient = connectGoogleAdsClient) {
    const customerId = normalizeGoogleAdsCustomerId(rawCustomerId)
    let config
    try { config = normalizeGoogleAdsConfig(decryptWorkspaceIntegration(integration.config_encrypted)) }
    catch { throw new Error("Your agency’s Google Ads connection needs attention. Contact your agency to continue.") }
    const staff = "userId" in scope
    const onboarding = "blockId" in scope
    const params = staff
        ? { p_workspace_id: scope.workspaceId, p_relationship_id: scope.relationshipId, p_user_id: scope.userId }
        : { p_token: scope.token, ...(onboarding ? { p_block_id: scope.blockId } : { p_workspace_id: scope.workspaceId }) }
    const source = staff ? "staff" : onboarding ? "onboarding" : "portal"
    const attemptId = randomUUID()
    const { data: prepared, error: beginError } = await supabaseAdmin.rpc(`begin_google_ads_${source}`, {
        ...params, p_customer_id: customerId, p_manager_id: config.manager_customer_id, p_attempt_id: attemptId,
        ...(staff ? { p_expected_config: integration.config_encrypted } : {}),
    })
    if (staff && beginError?.code === "42501") throw new GoogleAdsConnectionAccessError(beginError.message)
    if (beginError) throw new Error(["P0001", "22023", "42501"].includes(beginError.code) ? beginError.message : "The connection could not be prepared. Please try again.")
    const previousCustomerId = !staff && prepared && typeof prepared === "object" && typeof (prepared as Record<string, unknown>).previousCustomerId === "string"
        ? String((prepared as Record<string, unknown>).previousCustomerId)
        : null
    let result: Awaited<ReturnType<typeof connectGoogleAdsClient>> | null = null
    let message: string | null = null, diagnostic: string | null = null
    try {
        const budget = AbortSignal.timeout(50_000)
        result = await runner(config, customerId, sendRequest, (url, init) => fetch(url, { ...init, signal: AbortSignal.any([budget, init?.signal ?? budget]) }), false, previousCustomerId)
        if ("replacementWarning" in result && typeof result.replacementWarning === "string") diagnostic = result.replacementWarning
    }
    catch (error) { message = googleAdsClientError(error); diagnostic = googleAdsDiagnosticError(error) }
    const { data, error: finishError } = await supabaseAdmin.rpc(`finish_google_ads_${source}`, {
        ...params, p_attempt_id: attemptId, p_expected_config: integration.config_encrypted,
        ...(staff ? { p_customer_id: customerId } : {}),
        p_status: result?.status ?? "needs_attention", p_account_name: result?.status === "connected" ? result.accountName : null,
        p_currency: result?.status === "connected" ? result.currency : null, p_timezone: result?.status === "connected" ? result.timeZone : null, p_error: diagnostic,
    })
    if (staff && finishError?.code === "42501") throw new GoogleAdsConnectionAccessError(finishError.message)
    if (finishError) throw new Error(["P0001", "42501"].includes(finishError.code) ? finishError.message : "Google responded, but the connection could not be saved. Please check again.")
    if (message) throw new Error(message)
    const connection = googleAdsOnboardingResponse(data)
    if (!connection) throw new Error("The saved connection could not be confirmed. Please check again.")
    return connection
}
