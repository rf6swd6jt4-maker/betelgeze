import "server-only"

import { createHash, randomUUID } from "node:crypto"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createWindsorMetaAdsAuthorization, listWindsorMetaAdsAccounts, loadWindsorMetaAdsReport } from "@/lib/windsor"
import { decryptWorkspaceIntegration, encryptIntegrationCredential } from "@/lib/workspace-integrations"

type Identity = { workspaceId: string; relationshipId: string; userId: string }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const fingerprint = (text: string) => createHash("sha256").update(text).digest("hex")

async function command(identity: Identity, action: string, input: Record<string, unknown> = {}) {
    if (![identity.workspaceId, identity.relationshipId, identity.userId].every(value => uuid.test(value))) throw new Error("Invalid client connection.")
    const { data, error } = await supabaseAdmin.rpc("manage_windsor_meta_reporting", { p_action: action, p_input: { ...identity, ...input } })
    if (error || !data || typeof data !== "object") throw new Error(error?.code === "P0001" || error?.code === "42501" ? error.message : "Meta reporting maintenance could not be completed.")
    return data as Record<string, unknown>
}

export async function readMetaReportingMaintenance(identity: Identity) {
    return command(identity, "read")
}

async function context(identity: Identity) {
    const state = await command(identity, "context")
    const encrypted = typeof state.integrationEncrypted === "string" ? state.integrationEncrypted : ""
    let apiKey = ""
    try { apiKey = decryptWorkspaceIntegration(encrypted).api_key?.trim() ?? "" } catch { /* sanitized below */ }
    if (!apiKey) throw new Error("The agency Windsor connection needs attention.")
    return { state, apiKey, integrationFingerprint: fingerprint(encrypted) }
}

export async function beginMetaReportingMaintenance(identity: Identity, expectedRevision: string | null, reconnect: boolean) {
    const { state, apiKey, integrationFingerprint } = await context(identity)
    if (state.revision !== expectedRevision) throw new Error("The connection changed. Reload before continuing.")
    let accessToken = "", authorizationUrl: string | null = null
    if (!reconnect && typeof state.grantEncrypted === "string") {
        try { accessToken = decryptWorkspaceIntegration(state.grantEncrypted).access_token?.trim() ?? "" } catch { /* fresh authorization below */ }
    }
    if (!accessToken) {
        const authorization = await createWindsorMetaAdsAuthorization(apiKey)
        accessToken = authorization.accessToken
        authorizationUrl = authorization.authorizationUrl
    }
    const candidateId = randomUUID()
    await command(identity, "begin", { candidateId, expectedRevision, integrationFingerprint, authorizationEncrypted: encryptIntegrationCredential({ access_token: accessToken }), authorizationHash: fingerprint(accessToken) })
    return { candidateId, authorizationUrl }
}

async function candidateContext(identity: Identity, candidateId: string) {
    if (!uuid.test(candidateId)) throw new Error("Start a reporting verification first.")
    const result = await context(identity)
    const candidate = result.state.candidate as Record<string, unknown> | null
    if (!candidate || candidate.id !== candidateId || candidate.integration_fingerprint !== result.integrationFingerprint) throw new Error("This verification expired or was replaced. Start again.")
    let accessToken = ""
    try { accessToken = decryptWorkspaceIntegration(String(candidate.authorization_encrypted)).access_token?.trim() ?? "" } catch { /* sanitized below */ }
    if (!accessToken) throw new Error("This authorization is no longer available. Reconnect in Windsor.")
    return { ...result, candidate, accessToken }
}

export async function listMetaReportingCandidates(identity: Identity, candidateId: string) {
    const { apiKey, accessToken } = await candidateContext(identity, candidateId)
    return { accounts: await listWindsorMetaAdsAccounts(apiKey, accessToken) }
}

export async function previewMetaReportingCandidate(identity: Identity, candidateId: string, accountId: string) {
    const { state, apiKey, accessToken, integrationFingerprint } = await candidateContext(identity, candidateId)
    // Never accept an arbitrary agency-visible account from the browser.
    const accounts = await listWindsorMetaAdsAccounts(apiKey, accessToken)
    const account = accounts.find(item => item.id === accountId)
    if (!account) throw new Error("This account is not included in the client's Windsor authorization.")
    const report = { ...await loadWindsorMetaAdsReport(apiKey, account.id), period: "last_30d" as const, fetchedAt: new Date().toISOString(), accountId: account.id, accountName: account.name }
    await command(identity, "preview", { candidateId, expectedRevision: state.revision, integrationFingerprint, accountId: account.id, accountName: account.name, datasource: account.datasource, report })
    return { account, report }
}

export async function commitMetaReportingCandidate(identity: Identity, candidateId: string, accountId: string, expectedRevision: string | null) {
    if (!uuid.test(candidateId) || !/^[a-zA-Z0-9_-]{1,200}$/.test(accountId)) throw new Error("Preview a valid account before saving.")
    const { integrationFingerprint } = await context(identity)
    // The database rechecks revision, expiry and exact preview, and reconciles a
    // repeated candidate receipt without another provider call or history row.
    return command(identity, "commit", { candidateId, accountId, expectedRevision, integrationFingerprint })
}
