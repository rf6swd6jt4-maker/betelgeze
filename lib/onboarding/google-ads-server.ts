import { randomUUID } from "node:crypto"
import { getCanonicalSessionByToken } from "@/lib/onboarding/canonical"
import { connectGoogleAdsClient, googleAdsClientError, googleAdsDiagnosticError, normalizeGoogleAdsConfig } from "@/lib/google-ads"
import { googleAdsOnboardingResponse, normalizeGoogleAdsCustomerId } from "@/lib/onboarding/google-ads-state"
import { decryptWorkspaceIntegration } from "@/lib/workspace-integrations"
import { supabaseAdmin } from "@/lib/supabase/admin"

async function googleAdsContext(token: string, blockId: string, mutation: boolean) {
    if (typeof token !== "string" || token.length > 300 || typeof blockId !== "string" || !/^[a-f0-9-]{36}$/i.test(blockId)) throw new Error("This onboarding link is invalid.")
    const resolved = await getCanonicalSessionByToken(token)
    const step = resolved?.steps.find((step) => step.blocks?.some((block) => block.sessionBlockId === blockId && block.kind === "connection" && block.provider === "google_ads"))
    if (!resolved || !step) throw new Error("This Google Ads onboarding step is unavailable. Refresh your onboarding page.")
    if (mutation && (resolved.session.status !== "active" || step.status === "done")) throw new Error("This onboarding step has already been submitted.")
    const { data: integration, error } = await supabaseAdmin.from("workspace_integrations")
        .select("enabled, mode, connected_account_id, config_hint, config_encrypted")
        .eq("workspace_id", resolved.session.workspace_id).eq("provider", "google_ads").maybeSingle()
    if (error || !integration?.enabled || integration.mode !== "connected" || !integration.config_encrypted || !integration.connected_account_id) throw new Error("Your agency needs to connect its Google Ads manager account. Contact your agency to continue.")
    return { resolved, integration }
}

export async function loadGoogleAdsOnboarding(token: string, blockId: string) {
    const { resolved, integration } = await googleAdsContext(token, blockId, false)
    const { data, error } = await supabaseAdmin.from("relationship_google_ads_connections")
        .select("customer_id, manager_customer_id, status, account_name, last_verified_at")
        .eq("workspace_id", resolved.session.workspace_id).eq("relationship_id", resolved.session.relationship_id).maybeSingle()
    if (error) throw new Error("The saved Google Ads connection could not be loaded. Please try again.")
    const managerName = String(integration.config_hint?.manager_name || resolved.workspace.name)
    const connection = data ? googleAdsOnboardingResponse({
        customerId: data.customer_id, managerId: integration.connected_account_id, managerName,
        status: data.manager_customer_id === integration.connected_account_id ? data.status : "needs_attention",
        accountName: data.manager_customer_id === integration.connected_account_id ? data.account_name : null,
        verifiedAt: data.manager_customer_id === integration.connected_account_id ? data.last_verified_at : null,
    }) : null
    return { connection, managerId: String(integration.connected_account_id), managerName, satisfied: connection?.status === "connected" && resolved.satisfiedBlockIds.has(blockId) }
}

export async function runGoogleAdsOnboarding(token: string, blockId: string, rawCustomerId: string, sendRequest: boolean) {
    const customerId = normalizeGoogleAdsCustomerId(rawCustomerId)
    const { integration } = await googleAdsContext(token, blockId, true)
    let config
    try { config = normalizeGoogleAdsConfig(decryptWorkspaceIntegration(integration.config_encrypted)) }
    catch { throw new Error("Your agency’s Google Ads connection needs attention. Contact your agency to continue.") }
    const attemptId = randomUUID()
    const { error: beginError } = await supabaseAdmin.rpc("begin_google_ads_onboarding", {
        p_token: token, p_block_id: blockId, p_customer_id: customerId, p_manager_id: config.manager_customer_id, p_attempt_id: attemptId,
    })
    if (beginError) throw new Error(beginError.code === "P0001" || beginError.code === "22023" ? beginError.message : "The connection could not be prepared. Please try again.")
    let result: Awaited<ReturnType<typeof connectGoogleAdsClient>> | null = null
    let message: string | null = null
    let diagnostic: string | null = null
    try { result = await connectGoogleAdsClient(config, customerId, sendRequest) }
    catch (error) { message = googleAdsClientError(error); diagnostic = googleAdsDiagnosticError(error) }
    const { data, error: finishError } = await supabaseAdmin.rpc("finish_google_ads_onboarding", {
        p_token: token, p_block_id: blockId, p_attempt_id: attemptId, p_expected_config: integration.config_encrypted,
        p_status: result?.status ?? "needs_attention",
        p_account_name: result?.status === "connected" ? result.accountName : null,
        p_currency: result?.status === "connected" ? result.currency : null,
        p_timezone: result?.status === "connected" ? result.timeZone : null,
        p_error: diagnostic,
    })
    if (finishError) throw new Error(finishError.code === "P0001" ? finishError.message : "Google responded, but the connection could not be saved. Please check again.")
    if (message) throw new Error(message)
    const connection = googleAdsOnboardingResponse(data)
    if (!connection) throw new Error("The saved connection could not be confirmed. Please check again.")
    return connection
}
