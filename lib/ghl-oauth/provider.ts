import { readGhlJson } from "../client-portal/ghl-provider"

export const GHL_OAUTH_SCOPES = ["locations.readonly", "contacts.readonly", "opportunities.readonly", "calendars.readonly", "calendars/events.readonly", "users.readonly"] as const
export const GHL_OAUTH_CALLBACK = "https://app.betelgeze.com/api/integrations/calendar/callback"
const API = "https://services.leadconnectorhq.com"
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{10,80}$/.test(value)
const secret = (value: unknown): value is string => typeof value === "string" && /^[\x21-\x7e]{20,4096}$/.test(value)
export type GhlOAuthConfig = { clientId: string; clientSecret: string; appId: string; installUrl: string }
export type GhlOAuthToken = { accessToken: string; refreshToken: string; expiresAt: string; userType: "Location" | "Company"; locationId: string | null; companyId: string | null; scope: string }
export type GhlOAuthLocation = { id: string; name: string }

// Safe codes only: never include provider bodies, credentials or callback URLs.
export class GhlOAuthError extends Error {
    constructor(public code: "provider" | "response" | "scope" | "identity" | "configuration", public uncertain = false, public status?: number) { super(`HighLevel connection ${code}.`) }
}

export function ghlAuthorizationUrl(config: GhlOAuthConfig, state: string) {
    const url = new URL(config.installUrl)
    if (url.protocol !== "https:" || url.hostname !== "marketplace.gohighlevel.com" || url.port || url.username || url.password || !["/oauth/chooselocation", "/v2/oauth/chooselocation"].includes(url.pathname) || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new GhlOAuthError("configuration")
    // The v2 storefront stops at the app listing once every location is
    // installed. The OAuth chooser also authorises existing installations.
    url.pathname = "/oauth/chooselocation"
    url.searchParams.set("loginWindowOpenMode", "self")
    url.searchParams.set("state", state)
    url.searchParams.set("redirect_uri", GHL_OAUTH_CALLBACK)
    url.searchParams.set("client_id", config.clientId)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("scope", GHL_OAUTH_SCOPES.join(" "))
    return url.toString()
}

function parseToken(body: Record<string, unknown>, now: Date, expected?: { locationId?: string; companyId?: string; userType?: "Location" | "Company" }): GhlOAuthToken {
    const userType = body.userType ?? (expected?.locationId ? "Location" : null)
    if (!secret(body.access_token) || !secret(body.refresh_token) || body.token_type !== "Bearer" || !Number.isSafeInteger(body.expires_in) || Number(body.expires_in) < 300 || Number(body.expires_in) > 172800 || !["Location", "Company"].includes(String(userType))) throw new GhlOAuthError("response", true)
    if (typeof body.scope !== "string" || !GHL_OAUTH_SCOPES.every(scope => body.scope!.toString().split(/\s+/).includes(scope))) throw new GhlOAuthError("scope")
    if (userType === "Location" && !identifier(body.locationId)) throw new GhlOAuthError("identity")
    if (userType === "Company" && !identifier(body.companyId)) throw new GhlOAuthError("identity")
    if ((expected?.locationId && body.locationId !== expected.locationId) || (expected?.companyId && body.companyId != null && body.companyId !== expected.companyId) || (expected?.userType && userType !== expected.userType)) throw new GhlOAuthError("identity")
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: new Date(now.getTime() + Number(body.expires_in) * 1000).toISOString(), userType: userType as GhlOAuthToken["userType"], locationId: identifier(body.locationId) ? body.locationId : null, companyId: identifier(body.companyId) ? body.companyId : expected?.companyId ?? null, scope: body.scope }
}

async function request(path: string, init: RequestInit, fetcher: typeof fetch) {
    try {
        const response = await fetcher(`${API}${path}`, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json", Version: "v3", ...init.headers } })
        if (!response.ok) {
            await response.body?.cancel()
            throw new GhlOAuthError("provider", response.status >= 500, response.status)
        }
        return await readGhlJson(response, 262144)
    } catch (error) {
        if (error instanceof GhlOAuthError) throw error
        throw new GhlOAuthError("provider", true)
    }
}

export async function exchangeGhlCode(config: GhlOAuthConfig, code: string, fetcher: typeof fetch = fetch, now = new Date()) {
    if (!code || code.length > 4096) throw new GhlOAuthError("response")
    const body = await request("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code", code, redirect_uri: GHL_OAUTH_CALLBACK }) }, fetcher)
    return parseToken(body, now)
}

export async function listGhlInstalledLocations(config: GhlOAuthConfig, token: GhlOAuthToken, fetcher: typeof fetch = fetch, locationId?: string) {
    if (token.userType === "Location" && token.locationId) return { locations: [{ id: token.locationId, name: "Authorised sub-account" }], limited: false }
    if (token.userType !== "Company" || !token.companyId || (locationId && !identifier(locationId))) throw new GhlOAuthError("identity")
    const query = new URLSearchParams({ appId: config.appId, companyId: token.companyId, isInstalled: "true", restrictToUserLocations: "true", pageSize: "50", ...(locationId ? { locationId } : {}) })
    const body = await request(`/oauth/installed-locations?${query}`, { headers: { Authorization: `Bearer ${token.accessToken}` } }, fetcher)
    if (!Array.isArray(body.items) || body.items.length > 50 || !body.pagination || typeof body.pagination !== "object" || typeof (body.pagination as Record<string, unknown>).hasNextPage !== "boolean") throw new GhlOAuthError("response")
    const locations: GhlOAuthLocation[] = body.items.map(value => {
        if (!value || typeof value !== "object" || !identifier(value._id) || typeof value.name !== "string" || !value.name.trim() || value.isInstalled !== true) throw new GhlOAuthError("response")
        return { id: value._id, name: value.name.trim().slice(0, 200) }
    })
    if (new Set(locations.map(location => location.id)).size !== locations.length) throw new GhlOAuthError("response")
    // A provider-side filter is not an authorization boundary. Check the exact
    // selection locally, even when the bounded response contains other installs.
    if (locationId) {
        const selected = locations.find(location => location.id === locationId)
        if (!selected) throw new GhlOAuthError("identity")
        return { locations: [selected], limited: false }
    }
    return { locations, limited: (body.pagination as Record<string, unknown>).hasNextPage === true }
}

export async function ghlLocationToken(token: GhlOAuthToken, locationId: string, fetcher: typeof fetch = fetch, now = new Date()) {
    if (!identifier(locationId)) throw new GhlOAuthError("identity")
    if (token.userType === "Location") {
        if (token.locationId !== locationId) throw new GhlOAuthError("identity")
        return token
    }
    if (!token.companyId) throw new GhlOAuthError("identity")
    const body = await request("/oauth/location-token", { method: "POST", headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ companyId: token.companyId, locationId }) }, fetcher)
    return parseToken(body, now, { locationId, companyId: token.companyId, userType: "Location" })
}

export async function refreshGhlToken(config: GhlOAuthConfig, token: GhlOAuthToken, fetcher: typeof fetch = fetch, now = new Date()) {
    const body = await request("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: token.refreshToken, user_type: token.userType, redirect_uri: GHL_OAUTH_CALLBACK }) }, fetcher)
    return parseToken(body, now, { userType: token.userType, ...(token.locationId ? { locationId: token.locationId } : {}), ...(token.companyId ? { companyId: token.companyId } : {}) })
}
