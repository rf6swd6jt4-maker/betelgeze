import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import ts from "typescript"

const require = createRequire(import.meta.url)
const cache = new Map<string, Record<string, unknown>>()
function load(file: string): Record<string, unknown> {
    if (cache.has(file)) return cache.get(file)!
    const compiled = { exports: {} }
    const code = ts.transpileModule(readFileSync(`lib/${file}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("require", "module", "exports", code)((path: string) => path === "../client-portal/ghl-provider" ? load("client-portal/ghl-provider") : require(path), compiled, compiled.exports)
    cache.set(file, compiled.exports)
    return compiled.exports
}
const { GHL_OAUTH_SCOPES, GHL_OAUTH_CALLBACK, ghlAuthorizationUrl, exchangeGhlCode, listGhlInstalledLocations, ghlLocationToken, refreshGhlToken } = load("ghl-oauth/provider") as typeof import("../lib/ghl-oauth/provider")
const config = { clientId: "fixture-client", clientSecret: "synthetic-secret-never-live", appId: "fixture-app", installUrl: "https://marketplace.gohighlevel.com/oauth/chooselocation?fixture=1" }
const now = new Date("2026-10-20T10:00:00Z")
const body = (extra = {}) => ({ access_token: "synthetic-access-token-long-enough", refresh_token: "synthetic-refresh-token-long-enough", token_type: "Bearer", expires_in: 86400, userType: "Location", locationId: "location123456789", companyId: "company123456789", scope: GHL_OAUTH_SCOPES.join(" "), ...extra })
function fake(value: unknown, status = 200) {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = (async (url, init) => { calls.push({ url: String(url), init }); return Response.json(value, { status }) }) as typeof fetch
    return { calls, fetcher }
}
test("authorization is bound to the configured Marketplace and fixed callback, with a fresh state", () => {
    const url = new URL(ghlAuthorizationUrl(config, "a".repeat(43)))
    assert.equal(url.searchParams.get("state"), "a".repeat(43))
    assert.equal(url.searchParams.get("redirect_uri"), GHL_OAUTH_CALLBACK)
    assert.equal(url.searchParams.get("scope"), GHL_OAUTH_SCOPES.join(" "))
    const liveLink = new URL(ghlAuthorizationUrl({ ...config, installUrl: "https://marketplace.gohighlevel.com/v2/oauth/chooselocation?version_id=fixture-version" }, "a".repeat(43)))
    assert.equal(liveLink.pathname, "/v2/oauth/chooselocation")
    assert.equal(liveLink.searchParams.get("version_id"), "fixture-version")
    for (const installUrl of ["http://marketplace.gohighlevel.com/oauth/a", "https://marketplace.gohighlevel.com.evil.test/oauth/a", "https://evil.test/oauth/a", "https://user:pass@marketplace.gohighlevel.com/oauth/a", "https://marketplace.gohighlevel.com/apps"]) assert.throws(() => ghlAuthorizationUrl({ ...config, installUrl }, "a".repeat(43)))
    assert.throws(() => ghlAuthorizationUrl(config, "short"))
})
test("code exchange requests v3 and preserves refresh ownership without returning raw provider data", async () => {
    const f = fake(body()), token = await exchangeGhlCode(config, "synthetic-code", f.fetcher, now)
    assert.equal(token.expiresAt, "2026-10-21T10:00:00.000Z")
    assert.equal(token.locationId, "location123456789")
    assert.equal(f.calls[0].url, "https://services.leadconnectorhq.com/oauth/token")
    assert.equal((f.calls[0].init!.headers as Record<string, string>).Version, "v3")
    assert.equal(new URLSearchParams(f.calls[0].init!.body as URLSearchParams).get("redirect_uri"), GHL_OAUTH_CALLBACK)
    assert.equal(f.calls[0].init!.redirect, "error")
    assert.ok(f.calls[0].init!.signal)
})
test("missing permission, malformed expiry, wrong identity and missing rotating token fail closed", async () => {
    for (const change of [{ scope: "contacts.readonly" }, { expires_in: -1 }, { refresh_token: null }, { userType: "Location", locationId: "bad" }, { userType: "Company", companyId: "bad" }]) await assert.rejects(exchangeGhlCode(config, "code", fake(body(change)).fetcher, now))
    await assert.rejects(exchangeGhlCode(config, "code", fake({ error: "synthetic-private-provider-secret" }, 500).fetcher), error => error instanceof Error && !error.message.includes("synthetic-private"))
})
test("agency installs offer at most fifty verified installed sub-accounts and report another page", async () => {
    const company = await exchangeGhlCode(config, "code", fake(body({ userType: "Company", locationId: undefined })).fetcher, now)
    const f = fake({ items: [{ _id: "location123456789", name: "Fixture", isInstalled: true }], pagination: { hasNextPage: true } })
    const page = await listGhlInstalledLocations(config, company, f.fetcher)
    assert.deepEqual(page, { locations: [{ id: "location123456789", name: "Fixture" }], limited: true })
    const query = new URL(f.calls[0].url).searchParams
    assert.equal(query.get("restrictToUserLocations"), "true")
    assert.equal(query.get("pageSize"), "50")
    for (const value of [{ items: [{ _id: "location123456789", name: "Fixture", isInstalled: false }], pagination: { hasNextPage: false } }, { items: [], pagination: {} }]) await assert.rejects(listGhlInstalledLocations(config, company, fake(value).fetcher))
    await assert.rejects(listGhlInstalledLocations(config, company, f.fetcher, "differentlocation123"))
})
test("location-token and refresh cannot silently switch sub-account, company or token type", async () => {
    const token = await exchangeGhlCode(config, "code", fake(body()).fetcher, now)
    const company = { ...token, userType: "Company" as const, locationId: null }
    assert.equal((await ghlLocationToken(company, token.locationId!, fake(body()).fetcher, now)).refreshToken, token.refreshToken)
    await assert.rejects(ghlLocationToken(token, "differentlocation123", fake(body()).fetcher, now))
    for (const change of [{ locationId: "differentlocation123" }, { companyId: "differentcompany123" }, { userType: "Company" }]) {
        await assert.rejects(ghlLocationToken(company, token.locationId!, fake(body(change)).fetcher, now))
        await assert.rejects(refreshGhlToken(config, token, fake(body(change)).fetcher, now))
    }
    const f = fake(body({ refresh_token: "synthetic-new-rotating-refresh-token" }))
    const rotated = await refreshGhlToken(config, token, f.fetcher, now)
    assert.notEqual(rotated.refreshToken, token.refreshToken)
    assert.equal(new URLSearchParams(f.calls[0].init!.body as URLSearchParams).get("user_type"), "Location")
})
