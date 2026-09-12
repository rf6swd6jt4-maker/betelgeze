import { connectGoogleAdsClient } from "@/lib/google-ads"

export const ADS_SCOPE = "https://www.googleapis.com/auth/adwords"
export type AdsChoice = { id: string; name: string; loginId: string }
type Row = { customer?: Account; customerClient?: Account; customerManagerLink?: { resourceName?: string; status?: string } }
type Account = { id?: string; descriptiveName?: string; manager?: boolean; testAccount?: boolean; status?: string }

/** Bounded, credential-safe provider boundary. Raw Google errors never reach the client. */
async function request(url: string, token: string, body: unknown, loginId: string | undefined, fetcher: typeof fetch) {
    const response = await fetcher(url, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...(loginId ? { "login-customer-id": loginId } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(response.status === 429 ? "Google’s request limit was reached. Please try again later." : "Google could not read or approve this account. Check your Google Ads access, or connect using its customer ID.")
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let bytes = 0
    if (!reader) throw new Error("Google returned an empty response.")
    try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 524288) throw new Error("Google returned too many accounts. Connect using the customer ID instead."); chunks.push(part.value) } }
    finally { await reader.cancel().catch(() => {}) }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as { resourceNames?: string[]; results?: Row[]; nextPageToken?: string } }
    catch { throw new Error("Google returned an unreadable account response. Please retry.") }
}
const endpoint = (id: string, method = "googleAds:search") => `https://googleads.googleapis.com/v25/customers/${id}/${method}`

export async function discoverAdsAccounts(token: string, fetcher: typeof fetch = fetch) {
    const accessible = await request("https://googleads.googleapis.com/v25/customers:listAccessibleCustomers", token, null, undefined, fetcher)
    const roots = [...new Set((accessible.resourceNames ?? []).filter(x => /^customers\/\d{10}$/.test(x)).map(x => x.slice(10)))]
    let limited = roots.length > 8
    const choices = new Map<string, AdsChoice>()
    // At most eight roots, two concurrent workers and 100 resulting choices.
    const queue = roots.slice(0, 8)
    await Promise.all([0, 1].map(async () => {
        while (queue.length) {
            const root = queue.shift()!
            try {
                const detail = await request(endpoint(root), token, { query: "SELECT customer.id, customer.descriptive_name, customer.manager, customer.test_account, customer.status FROM customer LIMIT 1" }, root, fetcher)
                const account = detail.results?.[0]?.customer
                if (!account || String(account.id) !== root) { limited = true; continue }
                const add = (a: Account) => {
                    const id = String(a.id ?? "")
                    if (!/^\d{10}$/.test(id) || a.manager || a.testAccount || a.status !== "ENABLED") return
                    if (!choices.has(id) && choices.size >= 100) { limited = true; return }
                    if (!choices.has(id) || id === root) choices.set(id, { id, name: (a.descriptiveName || "Google Ads account").slice(0, 200), loginId: root })
                }
                if (!account.manager) add(account)
                else {
                    const children = await request(endpoint(root), token, { query: "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.test_account, customer_client.status FROM customer_client WHERE customer_client.manager = FALSE AND customer_client.status = 'ENABLED' LIMIT 101" }, root, fetcher)
                    if (children.nextPageToken || (children.results?.length ?? 0) > 100) limited = true
                    children.results?.slice(0, 100).forEach(row => { if (row.customerClient) add(row.customerClient) })
                }
            } catch { limited = true }
        }
    }))
    return { choices: [...choices.values()].sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), limited }
}

export function oauthConnectionRunner(accessToken: string, choice: AdsChoice): typeof connectGoogleAdsClient {
    return async (config, customerId, sendRequest, fetcher = fetch) => {
        if (customerId !== choice.id || !/^\d{10}$/.test(choice.loginId)) throw new Error("Choose an account returned by Google.")
        // Prove the precise selected account remains accessible before requesting agency access.
        const detail = await request(endpoint(customerId), accessToken, { query: "SELECT customer.id, customer.manager, customer.test_account, customer.status FROM customer LIMIT 1" }, choice.loginId, fetcher)
        const account = detail.results?.[0]?.customer
        if (String(account?.id) !== customerId || account?.manager || account?.testAccount || account?.status !== "ENABLED") throw new Error("This advertising account is unavailable. Choose an active, real advertising account.")
        const result = await connectGoogleAdsClient(config, customerId, sendRequest, fetcher)
        if (result.status === "connected") return result
        try {
            const links = await request(endpoint(customerId), accessToken, { query: `SELECT customer_manager_link.resource_name, customer_manager_link.status FROM customer_manager_link WHERE customer_manager_link.manager_customer = 'customers/${config.manager_customer_id}' AND customer_manager_link.status IN ('PENDING', 'ACTIVE') LIMIT 2` }, choice.loginId, fetcher)
            const pending = links.results?.map(row => row.customerManagerLink).find(link => link?.status === "PENDING")
            const resource = pending?.resourceName
            if (resource && new RegExp(`^customers/${customerId}/customerManagerLinks/${config.manager_customer_id}~[0-9]+$`).test(resource)) {
                await request(endpoint(customerId, "customerManagerLinks:mutate"), accessToken, { operations: [{ update: { resourceName: resource, status: "ACTIVE" }, updateMask: "status" }] }, choice.loginId, fetcher)
            }
            return await connectGoogleAdsClient(config, customerId, false, fetcher)
        } catch {
            // Invitation already exists. A non-admin or propagation delay stays explicitly pending.
            return { status: "pending" }
        }
    }
}
