import { createPrivateKey, sign } from "node:crypto"

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const ADS_SCOPE = "https://www.googleapis.com/auth/adwords"
const API_VERSION = "v25"

export type GoogleAdsConfig = {
    manager_customer_id: string
    developer_token: string
    client_email: string
    private_key: string
}

export function normalizeGoogleAdsConfig(config: Record<string, string>): GoogleAdsConfig {
    const managerId = (config.manager_customer_id ?? "").replace(/[-\s]/g, "")
    if (!/^\d{10}$/.test(managerId)) throw new Error("Enter the 10-digit Google Ads manager account ID.")
    const developerToken = config.developer_token?.trim() ?? ""
    if (!/^[A-Za-z0-9_-]{22}$/.test(developerToken)) throw new Error("Enter the developer token from your Google Ads manager account’s API Center.")
    const email = config.client_email?.trim() ?? ""
    if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(email)) throw new Error("Upload a Google Cloud service-account JSON key.")
    const privateKey = config.private_key?.trim() ?? ""
    try {
        if (createPrivateKey(privateKey).asymmetricKeyType !== "rsa") throw new Error("Invalid key")
    } catch {
        throw new Error("The service-account private key is invalid. Download a new JSON key from Google Cloud.")
    }
    return { manager_customer_id: managerId, developer_token: developerToken, client_email: email, private_key: privateKey }
}

export async function googleAdsConfigFromForm(formData: FormData): Promise<GoogleAdsConfig> {
    const file = formData.get("service_account_key")
    if (!(file instanceof File) || file.size === 0 || file.size > 16_384) throw new Error("Choose a Google Cloud service-account JSON key file (up to 16 KB).")
    let key: Record<string, unknown>
    try {
        key = JSON.parse(await file.text())
        if (!key || key.type !== "service_account") throw new Error("Wrong key type")
    } catch {
        throw new Error("This is not a Google Cloud service-account JSON key file.")
    }
    return normalizeGoogleAdsConfig({
        manager_customer_id: String(formData.get("manager_customer_id") ?? ""),
        developer_token: String(formData.get("developer_token") ?? ""),
        client_email: typeof key.client_email === "string" ? key.client_email : "",
        private_key: typeof key.private_key === "string" ? key.private_key : "",
    })
}

async function googleRequest(url: string, init: RequestInit, fetcher: typeof fetch) {
    try {
        return await fetcher(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) })
    } catch {
        throw new Error("Google could not be reached. Try verification again.")
    }
}

export class GoogleAdsApiError extends Error {
    codes: string[]
    status: number
    constructor(message: string, codes: string[], status: number) {
        super(message)
        this.name = "GoogleAdsApiError"
        this.codes = codes
        this.status = status
    }
}

function adsError(payload: unknown, status: number): GoogleAdsApiError {
    const error = (payload as { error?: { details?: Array<{ errors?: Array<{ errorCode?: Record<string, string> }>; reason?: string }> } })?.error
    const codes = error?.details?.flatMap((detail) => [detail.reason, ...(detail.errors?.flatMap((item) => Object.values(item.errorCode ?? {})) ?? [])]) ?? []
    return new GoogleAdsApiError(adsErrorMessage(codes.filter((code): code is string => Boolean(code)), status), codes.filter((code): code is string => Boolean(code)), status)
}

function adsErrorMessage(codes: string[], status: number): string {
    if (codes.includes("NOT_ADS_USER")) return "Add the service-account email in Google Ads → Admin → Access and security for this manager account."
    if (codes.includes("DEVELOPER_TOKEN_NOT_APPROVED")) return "This developer token only has test-account access. Use a token with Explorer, Basic, or Standard Access."
    if (codes.includes("DEVELOPER_TOKEN_INVALID")) return "Google rejected the developer token. Copy it again from the manager account’s API Center."
    if (codes.includes("SERVICE_DISABLED")) return "Enable the Google Ads API in the service account’s Google Cloud project, then retry."
    if (codes.includes("USER_PERMISSION_DENIED")) return "Grant the service-account email Read-only access in Google Ads → Admin → Access and security for this manager account."
    if (codes.includes("CUSTOMER_NOT_ENABLED")) return "This Google Ads account is not enabled. Check its status in Google Ads."
    if (status === 429) return "Google’s API limit was reached. Wait before trying verification again."
    if (status === 401) return "Google issued an access token but rejected Ads access. Check that the service-account email has access to this manager account."
    if (status === 403) return "Google denied API access. Check the developer token, enable the Google Ads API, and grant the service-account email access to this manager."
    return `Google Ads verification failed (${status}). Check the manager account ID and Google API configuration, then retry.`
}

async function authorizeGoogleAds(config: GoogleAdsConfig, fetcher: typeof fetch) {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
    const claims = Buffer.from(JSON.stringify({ iss: config.client_email, scope: ADS_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })).toString("base64url")
    const unsigned = `${header}.${claims}`
    const assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), config.private_key).toString("base64url")}`
    const authorization = await googleRequest(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    }, fetcher)
    const token = await authorization.json().catch(() => null) as { access_token?: string } | null
    if (!authorization.ok || !token?.access_token) throw new GoogleAdsApiError("Google could not authorize this service-account key. Check that the account and key are still active in Google Cloud.", ["SERVICE_ACCOUNT_AUTH_FAILED"], authorization.status)

    return token.access_token
}

type GoogleAdsCustomer = { id?: string; descriptiveName?: string; manager?: boolean; testAccount?: boolean; currencyCode?: string; timeZone?: string }
type GoogleAdsRow = {
    customer?: GoogleAdsCustomer
    customerClient?: GoogleAdsCustomer & { level?: string | number; status?: string }
    customerClientLink?: { status?: string; resourceName?: string; managerLinkId?: string }
}

async function adsCall(config: GoogleAdsConfig, token: string, customerId: string, method: string, body: unknown, fetcher: typeof fetch) {
    const response = await googleRequest(`https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/${method}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "developer-token": config.developer_token, "login-customer-id": config.manager_customer_id, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }, fetcher)
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw adsError(payload, response.status)
    return payload as { results?: GoogleAdsRow[]; result?: { resourceName?: string } } | null
}

export async function verifyGoogleAdsManager(input: Record<string, string>, fetcher: typeof fetch = fetch) {
    const config = normalizeGoogleAdsConfig(input)
    const token = await authorizeGoogleAds(config, fetcher)
    const payload = await adsCall(config, token, config.manager_customer_id, "googleAds:search", {
        query: "SELECT customer.id, customer.descriptive_name, customer.manager, customer.test_account, customer.currency_code, customer.time_zone FROM customer LIMIT 1",
    }, fetcher)
    const customer = payload?.results?.[0]?.customer as { id?: string; descriptiveName?: string; manager?: boolean; testAccount?: boolean; currencyCode?: string; timeZone?: string } | undefined
    if (!customer || String(customer.id) !== config.manager_customer_id) throw new Error("Google did not return the requested manager account. Check its ID and access permissions.")
    if (!customer.manager) throw new Error("This is an advertising account, not a manager account. Enter the agency’s Google Ads manager account ID.")
    if (customer.testAccount) throw new Error("This is a Google Ads test manager. Connect the agency’s production manager account.")
    return {
        account_id: config.manager_customer_id,
        manager_customer_id: config.manager_customer_id,
        manager_name: customer.descriptiveName || "Google Ads manager",
        service_account_email: config.client_email,
        currency: customer.currencyCode || null,
        time_zone: customer.timeZone || null,
        verified_at: new Date().toISOString(),
        capabilities: { manager_access: true, production_api_access: true },
    }
}

/** Only the manager can request a link. Client approval always happens in Google Ads. */
export async function connectGoogleAdsClient(
    input: Record<string, string>,
    customerId: string,
    sendRequest: boolean,
    fetcher: typeof fetch = fetch,
) {
    if (!/^\d{10}$/.test(customerId)) throw new Error("Enter your 10-digit Google Ads customer ID.")
    const config = normalizeGoogleAdsConfig(input)
    if (customerId === config.manager_customer_id) throw new Error("Enter the account that runs your ads, rather than the agency’s manager account.")
    const token = await authorizeGoogleAds(config, fetcher)
    const search = (query: string, id = config.manager_customer_id) => adsCall(config, token, id, "googleAds:search", { query }, fetcher)
    const hierarchy = await search(`SELECT customer_client.id, customer_client.level, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.id = ${customerId} LIMIT 1`)
    const child = hierarchy?.results?.[0]?.customerClient
    if (child && String(child.id) === customerId && Number(child.level) > 0) {
        if (child.manager) throw new Error("Choose the individual account that runs your ads, rather than a manager account.")
        if (child.status !== "ENABLED") throw new Error("This Google Ads account is not active. Check its status in Google Ads before connecting.")
        // Reading the client through this manager proves usable account access, including inherited links.
        const detail = await search("SELECT customer.id, customer.descriptive_name, customer.manager, customer.test_account, customer.currency_code, customer.time_zone FROM customer LIMIT 1", customerId)
        const account = detail?.results?.[0]?.customer
        if (!account || String(account.id) !== customerId || account.manager) throw new Error("Google could not confirm access to the selected advertising account. Try again.")
        if (account.testAccount) throw new Error("Use a real Google Ads account. A Betelgeze test relationship can connect a real account.")
        return { status: "connected" as const, accountName: account.descriptiveName ?? null, currency: account.currencyCode ?? null, timeZone: account.timeZone ?? null }
    }
    const links = await search(`SELECT customer_client_link.status FROM customer_client_link WHERE customer_client_link.client_customer = 'customers/${customerId}' AND customer_client_link.status IN ('ACTIVE', 'PENDING')`)
    const statuses = links?.results?.map((row) => row.customerClientLink?.status) ?? []
    if (statuses.includes("ACTIVE") || statuses.includes("PENDING")) return { status: "pending" as const }
    if (!sendRequest) throw new Error("There is no active or pending invitation for this account. Send an access request, then approve it in Google Ads.")
    try {
        const invitation = await adsCall(config, token, config.manager_customer_id, "customerClientLinks:mutate", {
            operation: { create: { clientCustomer: `customers/${customerId}`, status: "PENDING" } },
        }, fetcher)
        if (!invitation?.result?.resourceName) throw new Error("Google did not confirm the access request. Try again before approving in Google Ads.")
    } catch (error) {
        // Another tab or a response lost in transit may already have created the invitation.
        if (error instanceof GoogleAdsApiError && error.codes.some((code) => ["ALREADY_INVITED_BY_THIS_MANAGER", "ALREADY_MANAGED_BY_THIS_MANAGER"].includes(code))) return { status: "pending" as const }
        throw error
    }
    return { status: "pending" as const }
}

export function googleAdsClientError(error: unknown) {
    if (error instanceof GoogleAdsApiError) {
        if (error.codes.some((code) => ["INVALID_CUSTOMER_ID", "CLIENT_CUSTOMER_ID_INVALID", "CUSTOMER_NOT_FOUND"].includes(code))) return "Google could not find that customer ID. Check the 10 digits in your Google Ads account."
        if (error.codes.some((code) => ["TOO_MANY_MANAGERS", "CLIENT_HAS_TOO_MANY_MANAGERS", "TOO_MANY_INVITES"].includes(code))) return "Google could not add another manager request. Ask your agency to review this account’s existing managers and invitations."
        if (error.codes.includes("CUSTOMER_NOT_ENABLED")) return "This Google Ads account is not active. Check its status in Google Ads."
        if (error.status === 429) return "Google’s request limit has been reached. Please try again later."
        return "Your agency’s Google Ads connection needs attention. Contact your agency so they can check access and send the manager invitation."
    }
    // Messages generated above contain no provider payloads or credentials.
    return error instanceof Error ? error.message : "Google Ads could not be connected. Please try again."
}
