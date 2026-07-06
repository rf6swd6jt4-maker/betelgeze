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

export function publicRecordAdapter(metadata: Record<string, unknown> | null | undefined) {
    const adapter = metadata?.adapter
    return typeof adapter === "string" && adapter.trim() ? adapter.trim() : "socrata_public_records"
}

export function looksLikeGuardedOrAppShell(text: string) {
    return /Just a moment|Cloudflare|Attention Required|Incapsula|Request unsuccessful|captcha|recaptcha|Error 403|HTTP 403|Access Denied|outside the United States|Enable JavaScript and cookies|__cf_chl|challenge-platform|auraLoadingBox|auraErrorMask|Salesforce|<app-root\b|ng-version|Please enable JavaScript|edgesuite|Akamai/i.test(text)
}

export function publicRecordPollUnsafeReason(sourceKey: string, label: string, metadata: Record<string, unknown> | null | undefined) {
    const adapter = publicRecordAdapter(metadata)
    if (fragileHtmlPublicRecordSources.has(sourceKey) && metadata?.poll_safe_html !== true) {
        return `${label} is a guarded or app-shell public-record source. It needs a stable API, data-download index, or source-specific endpoint before poll-time activation.`
    }
    if (adapter === guardedHtmlAdapter && metadata?.poll_safe_html !== true) {
        return `${label} uses the generic guarded HTML adapter. Configure a source-specific parser or a stable public data endpoint before poll-time activation.`
    }
    return null
}
