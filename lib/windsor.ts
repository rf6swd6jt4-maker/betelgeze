import "server-only"

const WINDSOR_TIMEOUT_MS = 15_000

export type WindsorMetaAdsAccount = {
    id: string
    name: string
    datasource: string
}

export type WindsorMetaAdsReport = {
    currency: string | null
    totals: { spend: number; impressions: number; clicks: number; leads: number; ctr: number | null; cpc: number | null; costPerLead: number | null }
    daily: Array<{ date: string; spend: number; impressions: number; clicks: number; leads: number }>
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

// Provider metadata only: never log account values or authorization tokens.
function responseShape(value: unknown, depth = 0): unknown {
    if (depth > 5) return typeof value
    if (Array.isArray(value)) return { length: value.length, item: responseShape(value[0], depth + 1) }
    if (!value || typeof value !== "object") return typeof value
    return Object.fromEntries(Object.entries(value).slice(0, 15).map(([key, child]) => [
        /^[a-z_]{1,40}$/.test(key) ? key : "other_field", responseShape(child, depth + 1),
    ]))
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
    url.searchParams.set("access_token", accessToken)
    const payload = await windsorJson(url)
    const accounts: WindsorMetaAdsAccount[] = []
    function visit(value: unknown, inheritedSource: string | null = null, depth = 0) {
        if (depth > 8) throw new Error("Windsor returned an unexpected account response. Please try again.")
        if (Array.isArray(value)) { for (const item of value) visit(item, inheritedSource, depth + 1); return }
        if (!value || typeof value !== "object") throw new Error("Windsor returned an invalid account. Please try again.")
        const record = value as Record<string, unknown>
        if (typeof record.access_token === "string" && record.access_token !== accessToken) return
        const datasource = textValue(record, ["datasource", "ds_id", "source"]) || inheritedSource
        if (datasource && datasource !== "facebook_ads" && datasource !== "facebook") return
        const rawId = record.account_id ?? record.id
        if (rawId !== undefined && datasource) {
            const id = typeof rawId === "string" ? rawId.trim() : typeof rawId === "number" && Number.isSafeInteger(rawId) ? String(rawId) : ""
            if (!id || id.length > 200) throw new Error("Windsor returned an invalid account identifier. Please try again.")
            accounts.push({ id, name: textValue(record, ["account_name", "name"]) || `Meta Ads account ${id.replace(/^act_/, "")}`, datasource })
            return
        }
        let recognized = false
        for (const key of ["data", "results", "accounts", "linked_accounts", "facebook_ads", "facebook"]) {
            if (record[key] !== undefined) {
                recognized = true
                visit(record[key], key === "facebook_ads" || key === "facebook" ? key : datasource, depth + 1)
            }
        }
        if (!recognized) {
            console.error("Windsor account response format", responseShape(record))
            throw new Error("Windsor returned an unexpected account response. Please try again.")
        }
    }
    visit(payload)
    return [...new Map(accounts.map((account) => [account.id, account])).values()]
}

function reportRows(payload: unknown) {
    if (Array.isArray(payload)) return payload
    if (!payload || typeof payload !== "object") throw new Error("Windsor returned an invalid reporting response.")
    const record = payload as Record<string, unknown>
    if (typeof record.error === "string" || record.error === true) throw new Error("Windsor could not load this Meta Ads report.")
    if (Array.isArray(record.data)) return record.data
    if (Array.isArray(record.results)) return record.results
    throw new Error("Windsor returned an unexpected reporting response.")
}

function reportNumber(value: unknown) {
    if (value === null || value === undefined || value === "") return 0
    const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.replaceAll(",", "")) : Number.NaN
    if (!Number.isFinite(numeric) || numeric < 0) throw new Error("Windsor returned an invalid reporting value.")
    return numeric
}

export function parseWindsorMetaAdsReport(payload: unknown, now = new Date()): WindsorMetaAdsReport {
    const rows = reportRows(payload)
    if (rows.length > 500) throw new Error("Windsor returned too many reporting rows.")
    const byDate = new Map<string, { spend: number; impressions: number; clicks: number; leads: number }>()
    let currency: string | null = null
    for (const value of rows) {
        if (!value || typeof value !== "object") throw new Error("Windsor returned an invalid reporting row.")
        const row = value as Record<string, unknown>
        if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error("Windsor returned an invalid reporting date.")
        if (!currency && typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency)) currency = row.currency
        const current = byDate.get(row.date) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0 }
        current.spend += reportNumber(row.spend)
        current.impressions += reportNumber(row.impressions)
        current.clicks += reportNumber(row.clicks)
        current.leads += reportNumber(row.actions_lead)
        byDate.set(row.date, current)
    }
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const daily = Array.from({ length: 30 }, (_, index) => {
        const day = new Date(end)
        day.setUTCDate(end.getUTCDate() - (29 - index))
        const date = day.toISOString().slice(0, 10)
        return { date, ...(byDate.get(date) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0 }) }
    })
    const totals = daily.reduce((sum, row) => ({ spend: sum.spend + row.spend, impressions: sum.impressions + row.impressions, clicks: sum.clicks + row.clicks, leads: sum.leads + row.leads }), { spend: 0, impressions: 0, clicks: 0, leads: 0 })
    return {
        currency,
        totals: {
            ...totals,
            ctr: totals.impressions ? (totals.clicks / totals.impressions) * 100 : null,
            cpc: totals.clicks ? totals.spend / totals.clicks : null,
            costPerLead: totals.leads ? totals.spend / totals.leads : null,
        },
        daily,
    }
}

export async function loadWindsorMetaAdsReport(apiKey: string, accountId: string) {
    const normalizedAccountId = accountId.trim()
    if (!normalizedAccountId || normalizedAccountId.length > 200) throw new Error("This Meta Ads account is invalid.")
    const url = new URL("https://connectors.windsor.ai/facebook")
    url.searchParams.set("api_key", apiKey)
    url.searchParams.set("fields", "date,currency,spend,impressions,clicks,actions_lead")
    url.searchParams.set("date_preset", "last_30d")
    url.searchParams.set("select_accounts", normalizedAccountId)
    url.searchParams.set("_renderer", "json")
    return parseWindsorMetaAdsReport(await windsorJson(url))
}
