export type GhlMetrics = { contacts: number; opportunities: number; open: number; won: number; lost: number }
export type GhlSummary = {
    connected: boolean
    locationId: string | null
    locationName: string | null
    metrics: GhlMetrics | null
    refreshedAt: string | null
    error: string | null
    busy: boolean
}

export const ghlErrorMessages: Record<string, string> = {
    credentials: "GHL rejected this token. Check that it belongs to this sub-account and has not been revoked.",
    permissions: "The token needs read access to Contacts, Opportunities, and Locations (sub-accounts). Check its permissions in GHL.",
    location: "The Location ID does not match an accessible GHL sub-account. Check the ID and token together.",
    rate_limit: "GHL is limiting requests. Please wait a minute before refreshing again.",
    unavailable: "GHL could not be reached. Your last saved results are still available; please try again.",
    response: "GHL returned incomplete results. Your last saved results have been kept. Please try again.",
    busy: "A connection or refresh is already in progress. Please wait a minute, then try again.",
    cooldown: "Please wait a minute between connection or refresh attempts.",
    changed: "The connection changed while this request was running. Reload its status before trying again.",
}

export function isGhlMetrics(value: unknown): value is GhlMetrics {
    if (!value || typeof value !== "object") return false
    const record = value as Record<string, unknown>
    return ["contacts", "opportunities", "open", "won", "lost"].every((key) => Number.isSafeInteger(record[key]) && (record[key] as number) >= 0)
}
