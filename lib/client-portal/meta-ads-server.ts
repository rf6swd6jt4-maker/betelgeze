import "server-only"

import { createHash } from "node:crypto"
import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"
import { portalMetaAdsReport, type PortalMetaAdsReport } from "@/lib/client-portal/meta-ads-report"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { loadWindsorMetaAdsReport } from "@/lib/windsor"
import { decryptWorkspaceIntegration } from "@/lib/workspace-integrations"

const REPORT_FRESHNESS_MS = 15 * 60_000
const inFlight = new Map<string, Promise<PortalMetaAdsReport>>()

// Only fixed diagnostic codes may leave this boundary. Provider bodies, URLs,
// credentials and arbitrary exception messages must never reach runtime logs.
function reportFailureCode(error: unknown) {
    let message: unknown
    try { message = error instanceof Error ? Object.getOwnPropertyDescriptor(error, "message")?.value : null } catch { return "unexpected_error" }
    if (typeof message !== "string" || message.length > 200) return "unexpected_error"
    switch (message) {
        case "report-save-changed": return "report_save_changed"
        case "The agency’s Windsor.ai connection needs attention. Contact your agency to continue.": return "provider_auth"
        case "Windsor.ai is receiving too many requests. Wait a moment, then check again.": return "provider_rate_limited"
        case "Windsor.ai could not be reached. Check your internet connection and try again.": return "provider_unreachable"
        case "Windsor returned too much data.": return "response_too_large"
        case "Windsor returned an empty response.": return "empty_response"
        case "Windsor returned an invalid reporting response.": return "invalid_response"
        case "Windsor returned an unexpected reporting response.": return "unexpected_response"
        case "Windsor could not load this Meta Ads report.": return "provider_report_error"
        case "Windsor returned too many reporting rows.": return "too_many_rows"
        case "Windsor returned an invalid reporting row.": return "invalid_row"
        case "Windsor returned an incomplete reporting value.": return "incomplete_value"
        case "Windsor returned an invalid reporting value.": return "invalid_value"
        case "Windsor returned an invalid reporting date.": return "invalid_date"
        case "Windsor returned a date outside the requested report.": return "date_out_of_range"
        case "Windsor returned a report for a different account.": return "account_mismatch"
        case "Windsor returned an invalid or mixed reporting currency.": return "currency_invalid"
        case "This Meta Ads account is invalid.": return "account_invalid"
    }
    if (/^Windsor\.ai could not complete this request \(4\d{2}\)\. Try again\.$/.test(message)) return "provider_http_4xx"
    if (/^Windsor\.ai could not complete this request \(5\d{2}\)\. Try again\.$/.test(message)) return "provider_http_5xx"
    return "unexpected_error"
}

function logReportFailure(code: ReturnType<typeof reportFailureCode> | "integration_unavailable" | "credential_decrypt" | "credential_missing") {
    console.error("Client portal Meta Ads diagnostic", code)
}

export async function loadPortalMetaAdsReport(token: string, refresh = false): Promise<PortalMetaAdsReport | null> {
    const access = await resolveClientPortalAccessByToken(token)
    if (!access) return null

    const [{ data: connection, error: connectionError }, { data: integration, error: integrationError }] = await Promise.all([
        supabaseAdmin.from("relationship_windsor_meta_ads_connections")
            .select("id, account_id, account_name, integration_fingerprint, reporting_revision, reporting_verified_at, last_report, last_report_error")
            .eq("workspace_id", access.workspace.id)
            .eq("relationship_id", access.relationship.id)
            .eq("status", "connected")
            .maybeSingle(),
        supabaseAdmin.from("workspace_integrations")
            .select("enabled, mode, config_encrypted")
            .eq("workspace_id", access.workspace.id)
            .eq("provider", "windsor")
            .maybeSingle(),
    ])
    if (connectionError || integrationError) throw new Error("Meta Ads reporting could not be loaded.")
    if (!connection?.account_id) return null
    const revision = connection.reporting_revision ?? connection.id
    const parsed = portalMetaAdsReport(connection.last_report)
    const retained = parsed?.accountId === connection.account_id && parsed?.connectionRevision === revision ? parsed : null
    const verificationWarning = connection.reporting_verified_at ? null : "Your agency still needs to verify that this is the intended advertising account."
    const fingerprint = integration?.config_encrypted ? createHash("sha256").update(integration.config_encrypted).digest("hex") : null
    const integrationReady = integration?.enabled && integration.mode === "connected" && fingerprint === connection.integration_fingerprint
    if (retained && !refresh) {
        const stale = !integrationReady || Boolean(connection.last_report_error) || retained.dateTo !== new Date().toISOString().slice(0, 10) || Date.now() - Date.parse(retained.fetchedAt) >= REPORT_FRESHNESS_MS
        return { ...retained, freshness: stale ? "stale" : "current", warning: !integrationReady || connection.last_report_error ? "The latest report check failed. These are the last successfully retrieved figures." : verificationWarning }
    }
    const fallback = (): PortalMetaAdsReport => {
        if (!retained) throw new Error("Meta Ads reporting is temporarily unavailable.")
        return { ...retained, freshness: "stale", warning: "The latest report check failed. These are the last successfully retrieved figures." }
    }
    if (!integrationReady || !integration?.config_encrypted) { logReportFailure("integration_unavailable"); return fallback() }
    let apiKey = ""
    try { apiKey = decryptWorkspaceIntegration(integration.config_encrypted).api_key?.trim() || "" } catch {
        logReportFailure("credential_decrypt")
        return fallback()
    }
    if (!apiKey) { logReportFailure("credential_missing"); return fallback() }
    // An explicit refresh must retain its result even while a read-only first load is pending.
    const key = `${access.workspace.id}:${access.relationship.id}:${revision}:${fingerprint}:${refresh ? "refresh" : "read"}`
    let pending = inFlight.get(key)
    if (!pending) {
        if (inFlight.size >= 128) return fallback()
        pending = (async () => {
            const startedAt = new Date()
            try {
                const report = await loadWindsorMetaAdsReport(apiKey, connection.account_id, startedAt)
                const saved: PortalMetaAdsReport = { ...report, accountId: connection.account_id, accountName: connection.account_name ?? null,
                    connectionRevision: revision, fetchedAt: startedAt.toISOString(), period: "last_30d", freshness: "current", warning: verificationWarning }
                if (!refresh) return saved
                const { data, error } = await supabaseAdmin.rpc("save_windsor_meta_report", { p_workspace_id: access.workspace.id, p_relationship_id: access.relationship.id,
                    p_revision: revision, p_fingerprint: fingerprint, p_report: saved, p_started_at: startedAt.toISOString() })
                if (error || data !== true) throw new Error("report-save-changed")
                return saved
            } catch (error) {
                const code = reportFailureCode(error)
                if (code === "report_save_changed") throw new Error("The reporting account changed. Reload the portal.")
                logReportFailure(code)
                if (!refresh) return fallback()
                const { data, error: saveError } = await supabaseAdmin.rpc("save_windsor_meta_report", { p_workspace_id: access.workspace.id, p_relationship_id: access.relationship.id,
                    p_revision: revision, p_fingerprint: fingerprint, p_report: null, p_error: "unavailable", p_started_at: startedAt.toISOString() })
                if (saveError || data !== true) throw new Error("The reporting account changed. Reload the portal.")
                return fallback()
            }
        })().finally(() => { inFlight.delete(key) })
        inFlight.set(key, pending)
    }
    return pending
}
