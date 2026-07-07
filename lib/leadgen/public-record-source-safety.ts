export const fragileHtmlPublicRecordSources = new Set([
    "registry.fl.sunbiz",
    "registry.fl.fictitious_names",
    "state_license.fl.fdacs_pest",
    "state_license.fl.fdacs_auto_repair",
    "registry.fl.miami_dade_lbt",
    "registry.fl.tampa_btr",
    "registry.fl.jacksonville_btr",
    "registry.ca.bizfile",
    "state_license.az.roc",
    "state_license.az.pest_management",
    "registry.az.corp_commission",
])

export const guardedHtmlAdapter = "guarded_html_search"

export type PublicRecordSourceHealthStatus = "healthy" | "degraded" | "blocked" | "unknown"

export type PublicRecordFailureKind =
    | "challenge"
    | "configuration"
    | "timeout"
    | "rate_limited"
    | "server_error"
    | "network"
    | "parser"
    | "unknown"

export type PublicRecordFailureClassification = {
    kind: PublicRecordFailureKind
    healthStatus: Exclude<PublicRecordSourceHealthStatus, "healthy">
    sourceScoped: boolean
    skipRemainingTasks: boolean
}

export function publicRecordAdapter(metadata: Record<string, unknown> | null | undefined) {
    const adapter = metadata?.adapter
    return typeof adapter === "string" && adapter.trim() ? adapter.trim() : "socrata_public_records"
}

export function looksLikeGuardedOrAppShell(text: string) {
    return /Just a moment|Cloudflare|Attention Required|Incapsula|Request unsuccessful|captcha|recaptcha|Error 403|HTTP 403|Access Denied|outside the United States|Enable JavaScript and cookies|__cf_chl|challenge-platform|auraLoadingBox|auraErrorMask|Salesforce|<app-root\b|ng-version|Please enable JavaScript|edgesuite|Akamai/i.test(text)
}

export function publicRecordPollUnsafeReason(sourceKey: string, label: string, metadata: Record<string, unknown> | null | undefined) {
    const adapter = publicRecordAdapter(metadata)
    if (adapter === "sunbiz_owner_index") {
        return `${label} uses the retired Supabase Sunbiz bulk index. The index table was removed because it exceeds the database storage tier; configure an external Sunbiz lookup before poll-time activation.`
    }
    if (adapter === "sunbiz_external_lookup_required") {
        return `${label} needs an external Sunbiz file/shard lookup before poll-time activation.`
    }
    if (adapter === "california_external_lookup_required") {
        return `${label} needs a stable California bulk/API lookup before poll-time activation.`
    }
    if (fragileHtmlPublicRecordSources.has(sourceKey) && adapter === guardedHtmlAdapter && metadata?.poll_safe_html !== true) {
        return `${label} is a guarded or app-shell public-record source. It needs a stable API, data-download index, or source-specific endpoint before poll-time activation.`
    }
    if (adapter === guardedHtmlAdapter && metadata?.poll_safe_html !== true) {
        return `${label} uses the generic guarded HTML adapter. Configure a source-specific parser or a stable public data endpoint before poll-time activation.`
    }
    return null
}

export function classifyPublicRecordFailure(error: unknown): PublicRecordFailureClassification {
    const message = error instanceof Error ? error.message : String(error)
    if (/anti-bot|captcha|recaptcha|geo-block|Cloudflare|Incapsula|Access Denied|outside the United States|Enable JavaScript|app shell|app-shell|Salesforce|Akamai|HTTP 401|HTTP 403/i.test(message)) {
        return { kind: "challenge", healthStatus: "blocked", sourceScoped: true, skipRemainingTasks: true }
    }
    if (/poll-time activation|generic guarded HTML|stable .*endpoint|missing .*metadata|missing .*key|missing search_url|requires/i.test(message)) {
        return { kind: "configuration", healthStatus: "blocked", sourceScoped: true, skipRemainingTasks: true }
    }
    if (/timed out|AbortError|ETIMEDOUT/i.test(message)) {
        return { kind: "timeout", healthStatus: "degraded", sourceScoped: true, skipRemainingTasks: true }
    }
    if (/HTTP 429|rate limit|too many requests/i.test(message)) {
        return { kind: "rate_limited", healthStatus: "degraded", sourceScoped: true, skipRemainingTasks: true }
    }
    if (/HTTP 5\d\d|temporarily unavailable|service unavailable|bad gateway|gateway timeout/i.test(message)) {
        return { kind: "server_error", healthStatus: "degraded", sourceScoped: true, skipRemainingTasks: true }
    }
    if (/fetch failed|ECONNRESET|EAI_AGAIN|ENOTFOUND|network/i.test(message)) {
        return { kind: "network", healthStatus: "degraded", sourceScoped: true, skipRemainingTasks: true }
    }
    if (/parseable public-record rows|Unexpected token|JSON/i.test(message)) {
        return { kind: "parser", healthStatus: "degraded", sourceScoped: false, skipRemainingTasks: false }
    }
    return { kind: "unknown", healthStatus: "degraded", sourceScoped: false, skipRemainingTasks: false }
}
