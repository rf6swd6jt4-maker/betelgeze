import "server-only"

import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"
import type { PortalMetaAdsReport } from "@/lib/client-portal/meta-ads-report"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { loadWindsorMetaAdsReport } from "@/lib/windsor"
import { decryptWorkspaceIntegration } from "@/lib/workspace-integrations"

export async function loadPortalMetaAdsReport(token: string): Promise<PortalMetaAdsReport | null> {
    const access = await resolveClientPortalAccessByToken(token)
    if (!access) return null

    const [{ data: connection, error: connectionError }, { data: integration, error: integrationError }] = await Promise.all([
        supabaseAdmin.from("relationship_windsor_meta_ads_connections")
            .select("account_id, account_name")
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
    if (!integration?.enabled || integration.mode !== "connected" || !integration.config_encrypted) throw new Error("Meta Ads reporting is temporarily unavailable.")

    let apiKey = ""
    try { apiKey = decryptWorkspaceIntegration(integration.config_encrypted).api_key?.trim() || "" } catch { /* handled below */ }
    if (!apiKey) throw new Error("Meta Ads reporting is temporarily unavailable.")
    const report = await loadWindsorMetaAdsReport(apiKey, connection.account_id)
    return {
        accountName: connection.account_name ?? null,
        currency: report.currency,
        fetchedAt: new Date().toISOString(),
        period: "last_30d",
        totals: report.totals,
        daily: report.daily,
    }
}
