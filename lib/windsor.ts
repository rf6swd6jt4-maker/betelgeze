import "server-only"

const WINDSOR_TIMEOUT_MS = 15_000

export type WindsorMetaAdsAccount = {
    id: string
    name: string
    datasource: string
}

function providerError(status: number, fallback: string) {
    if (status === 401 || status === 403) return "The agency’s Windsor.ai connection needs attention. Contact your agency to continue."
    if (status === 429) return "Windsor.ai is receiving too many requests. Wait a moment, then check again."
    return fallback
}

async function windsorJson(url: URL) {
    const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "Betelgeze/1.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(WINDSOR_TIMEOUT_MS),
    }).catch(() => null)
    if (!response) throw new Error("Windsor.ai could not be reached. Check your internet connection and try again.")
    const text = await response.text()
    let payload: unknown = null
    try { payload = text ? JSON.parse(text) : null } catch { payload = text }
    if (!response.ok) throw new Error(providerError(response.status, `Windsor.ai could not complete this request (${response.status}). Try again.`))
    return payload
}

function textValue(value: unknown, keys: string[]) {
    if (!value || typeof value !== "object") return null
    const record = value as Record<string, unknown>
    for (const key of keys) if (typeof record[key] === "string" && record[key]) return record[key] as string
    return null
}

function rows(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload
    if (!payload || typeof payload !== "object") throw new Error("Windsor returned an unreadable account response. Please try again.")
    const record = payload as Record<string, unknown>
    for (const key of ["data", "results", "accounts", "linked_accounts"]) if (Array.isArray(record[key])) return record[key] as unknown[]
    // Log field names/types only; never provider values, tokens or account data.
    console.error("Windsor linked-account response format", Object.fromEntries(Object.entries(record).slice(0, 12).map(([key, value]) => [key, Array.isArray(value) ? "array" : typeof value])))
    throw new Error("Windsor returned an unexpected account response. Please try again.")
}

export async function createWindsorMetaAdsAuthorization(apiKey: string) {
    const url = new URL("https://onboard.windsor.ai/api/team/generate-co-user-url/")
    url.searchParams.set("allowed_sources", "facebook")
    url.searchParams.set("api_key", apiKey)
    const payload = await windsorJson(url)
    const authorizationUrl = typeof payload === "string" ? payload : textValue(payload, ["url", "connect_url", "auth_url"])
    if (!authorizationUrl) throw new Error("Windsor.ai did not return an authorization link. Confirm that this is the team owner API key.")
    let parsed: URL
    try { parsed = new URL(authorizationUrl) } catch { throw new Error("Windsor.ai returned an invalid authorization link. Try again.") }
    if (parsed.protocol !== "https:" || (parsed.hostname !== "windsor.ai" && !parsed.hostname.endsWith(".windsor.ai"))) throw new Error("Windsor.ai returned an unexpected authorization destination.")
    const accessToken = parsed.searchParams.get("access_token")?.trim()
    if (!accessToken) throw new Error("Windsor.ai did not identify this authorization link. Try creating it again.")
    return { authorizationUrl: parsed.toString(), accessToken }
}

export async function listWindsorMetaAdsAccounts(apiKey: string, accessToken: string): Promise<WindsorMetaAdsAccount[]> {
    const url = new URL("https://onboard.windsor.ai/api/team/co-user-linked-accounts/")
    url.searchParams.set("api_key", apiKey)
    url.searchParams.set("ds_id", "facebook_ads")
    url.searchParams.set("access_token", accessToken)
    const payload = await windsorJson(url)
    const accounts = rows(payload).flatMap((item): WindsorMetaAdsAccount[] => {
        if (!item || typeof item !== "object") throw new Error("Windsor returned an invalid account. Please try again.")
        const record = item as Record<string, unknown>
        if (typeof record.access_token === "string" && record.access_token !== accessToken) return []
        const rawId = record.account_id ?? record.id
        const id = typeof rawId === "string" ? rawId.trim() : typeof rawId === "number" && Number.isSafeInteger(rawId) ? String(rawId) : ""
        if (!id || id.length > 200) throw new Error("Windsor returned an invalid account identifier. Please try again.")
        const datasource = textValue(item, ["datasource", "ds_id", "source"]) || "facebook_ads"
        if (datasource !== "facebook_ads" && datasource !== "facebook") return []
        return [{ id, name: textValue(item, ["account_name", "name"]) || `Meta Ads account ${id.replace(/^act_/, "")}`, datasource }]
    })
    return [...new Map(accounts.map((account) => [account.id, account])).values()]
}
