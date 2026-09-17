import { createHash } from "node:crypto"
import { getCanonicalSessionByToken } from "@/lib/onboarding/canonical"
import { createWindsorMetaAdsAuthorization, listWindsorMetaAdsAccounts, type WindsorMetaAdsAccount } from "@/lib/windsor"
import { decryptWorkspaceIntegration, encryptIntegrationCredential } from "@/lib/workspace-integrations"
import { supabaseAdmin } from "@/lib/supabase/admin"

type SavedConnection = {
    status: "pending" | "connected" | "needs_attention"
    accountId: string | null
    accountName: string | null
    datasource: string | null
    connectedAt: string | null
}

function savedConnection(value: Record<string, unknown> | null): SavedConnection | null {
    if (!value) return null
    const status = value.status === "connected" || value.status === "needs_attention" ? value.status : "pending"
    return {
        status,
        accountId: typeof value.account_id === "string" ? value.account_id : null,
        accountName: typeof value.account_name === "string" ? value.account_name : null,
        datasource: typeof value.datasource === "string" ? value.datasource : null,
        connectedAt: typeof value.connected_at === "string" ? value.connected_at : null,
    }
}

async function windsorContext(token: string, blockId: string, mutation: boolean) {
    if (typeof token !== "string" || token.length > 300 || typeof blockId !== "string" || !/^[a-f0-9-]{36}$/i.test(blockId)) throw new Error("This onboarding link is invalid.")
    const resolved = await getCanonicalSessionByToken(token)
    const step = resolved?.steps.find((candidate) => candidate.blocks?.some((block) => block.sessionBlockId === blockId && block.kind === "connection" && block.provider === "meta_ads"))
    if (!resolved || !step) throw new Error("This Meta Ads onboarding step is unavailable. Refresh your onboarding page.")
    if (mutation && (resolved.session.status !== "active" || step.status === "done")) throw new Error("This onboarding step has already been submitted.")
    const { data: integration, error } = await supabaseAdmin.from("workspace_integrations")
        .select("enabled, mode, config_encrypted")
        .eq("workspace_id", resolved.session.workspace_id).eq("provider", "windsor").maybeSingle()
    if (error || !integration?.enabled || integration.mode !== "connected" || !integration.config_encrypted) throw new Error("Your agency needs to connect Windsor.ai before Meta Ads reporting can be authorized.")
    let apiKey = ""
    try { apiKey = decryptWorkspaceIntegration(integration.config_encrypted).api_key?.trim() || "" } catch { /* handled below */ }
    if (!apiKey) throw new Error("Your agency’s Windsor.ai connection needs attention. Contact your agency to continue.")
    return { resolved, integration, apiKey }
}

export async function loadWindsorMetaAdsOnboarding(token: string, blockId: string) {
    const { resolved } = await windsorContext(token, blockId, false)
    const { data, error } = await supabaseAdmin.from("relationship_windsor_meta_ads_connections")
        .select("status, account_id, account_name, datasource, connected_at")
        .eq("workspace_id", resolved.session.workspace_id).eq("relationship_id", resolved.session.relationship_id).maybeSingle()
    if (error) throw new Error("The saved Meta Ads reporting connection could not be loaded. Please try again.")
    const connection = savedConnection(data as Record<string, unknown> | null)
    return { connection, satisfied: connection?.status === "connected" && resolved.satisfiedBlockIds.has(blockId) }
}

export async function prepareWindsorMetaAdsAuthorization(token: string, blockId: string) {
    const { integration, apiKey } = await windsorContext(token, blockId, true)
    const authorization = await createWindsorMetaAdsAuthorization(apiKey)
    const encryptedToken = encryptIntegrationCredential({ access_token: authorization.accessToken })
    const { error } = await supabaseAdmin.rpc("begin_windsor_meta_ads_onboarding", {
        p_token: token,
        p_block_id: blockId,
        p_authorization_encrypted: encryptedToken,
        p_authorization_hash: createHash("sha256").update(authorization.accessToken).digest("hex"),
        p_integration_fingerprint: createHash("sha256").update(integration.config_encrypted).digest("hex"),
    })
    if (error) throw new Error(error.code === "P0001" ? error.message : "The Meta Ads connection could not be prepared. Please try again.")
    return authorization.authorizationUrl
}

export async function checkWindsorMetaAdsOnboarding(token: string, blockId: string, selectedAccountId?: string | null) {
    const { resolved, integration, apiKey } = await windsorContext(token, blockId, true)
    const { data: pending, error: pendingError } = await supabaseAdmin.from("relationship_windsor_meta_ads_connections")
        .select("authorization_encrypted, authorization_hash, integration_fingerprint, status, account_id, account_name, datasource, connected_at")
        .eq("workspace_id", resolved.session.workspace_id).eq("relationship_id", resolved.session.relationship_id).maybeSingle()
    if (pendingError) throw new Error("Your saved Meta Ads connection could not be loaded. Please try again.")
    if (pending?.status === "connected" && resolved.satisfiedBlockIds.has(blockId)) {
        return { connection: savedConnection(pending), accounts: [], satisfied: true }
    }
    if (!pending?.authorization_encrypted) throw new Error("Start the Meta Ads connection and finish selecting your account in Windsor.")
    if (pending.integration_fingerprint !== createHash("sha256").update(integration.config_encrypted).digest("hex")) throw new Error("Your agency changed its Windsor.ai connection. Start the Meta Ads connection again.")
    let accessToken = ""
    try { accessToken = decryptWorkspaceIntegration(pending.authorization_encrypted).access_token?.trim() || "" } catch { /* handled below */ }
    if (!accessToken) throw new Error("This Windsor.ai authorization link is no longer usable. Start the connection again.")
    const accounts = await listWindsorMetaAdsAccounts(apiKey, accessToken)
    if (!accounts.length) return { connection: savedConnection({ status: "pending" }), accounts, satisfied: false }
    let selected: WindsorMetaAdsAccount | undefined
    if (selectedAccountId) selected = accounts.find((account) => account.id === selectedAccountId)
    else if (accounts.length === 1) selected = accounts[0]
    if (!selected) return { connection: savedConnection({ status: "pending" }), accounts, satisfied: false }
    const { data, error } = await supabaseAdmin.rpc("complete_windsor_meta_ads_onboarding", {
        p_token: token,
        p_block_id: blockId,
        p_authorization_hash: pending.authorization_hash,
        p_account_id: selected.id,
        p_account_name: selected.name,
        p_datasource: selected.datasource,
        p_integration_fingerprint: pending.integration_fingerprint,
    })
    if (error) {
        // Another tab may have committed while this provider request was in flight.
        const saved = await loadWindsorMetaAdsOnboarding(token, blockId)
        if (saved.satisfied) return { ...saved, accounts: [] }
        throw new Error(error.code === "P0001" ? error.message : "Windsor connected the account, but we could not save it. Please try again.")
    }
    const response = data && typeof data === "object" ? data as Record<string, unknown> : null
    return { connection: savedConnection({ status: "connected", account_id: response?.accountId, account_name: response?.accountName, datasource: response?.datasource, connected_at: response?.connectedAt }), accounts: [], satisfied: true }
}
