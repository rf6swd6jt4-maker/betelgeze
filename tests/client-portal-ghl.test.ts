import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import ts from "typescript"
const require = createRequire(import.meta.url)
const loaded = new Map<string, unknown>()
function load(name: string): Record<string, unknown> {
    if (loaded.has(name)) return loaded.get(name) as Record<string, unknown>
    const compiled = { exports: {} }
    const code = ts.transpileModule(readFileSync(`lib/client-portal/${name}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("require", "module", "exports", code)((path: string) => path.startsWith("./ghl-") ? load(path.slice(2)) : require(path), compiled, compiled.exports)
    loaded.set(name, compiled.exports)
    return compiled.exports
}
const { fetchGhlMetrics, GhlError, parseGhlCredentials, readGhlJson } = load("ghl-provider") as typeof import("../lib/client-portal/ghl-provider")
const { handlePortalGhl } = load("ghl-handler") as typeof import("../lib/client-portal/ghl-handler")

const credentials = { locationId: "location1234567890", privateToken: "pit-test-secret-1234567890" }
const metrics = { contacts: 12000, opportunities: 48, open: 28, won: 14, lost: 6 }
const connected = { connected: true, locationId: credentials.locationId, locationName: "Test business", metrics, refreshedAt: "2026-09-12T01:00:00Z", busy: false, error: null }
const request = (body: unknown) => new Request("https://portal.example/api/ghl", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const access = { workspace: { id: "workspace-a" }, relationship: { id: "relationship-a", is_test: true } }

test("credentials reject URLs, control characters and overlong tokens", () => {
    assert.deepEqual(parseGhlCredentials(credentials), credentials)
    assert.equal(parseGhlCredentials({ ...credentials, locationId: "https://evil.example" }), null)
    assert.equal(parseGhlCredentials({ ...credentials, privateToken: credentials.privateToken + "\r\nInjected: yes" }), null)
    assert.equal(parseGhlCredentials({ ...credentials, privateToken: "a".repeat(4097) }), null)
})

function providerFixture(transform?: (path: string, body: Record<string, unknown>, value: Record<string, unknown>) => Record<string, unknown>) {
    const calls: { path: string; body: Record<string, unknown>; options: RequestInit }[] = []
    const fetcher: typeof fetch = async (input, options) => {
        const url = new URL(String(input)), body = JSON.parse(String(options?.body ?? "{}"))
        assert.equal(url.origin, "https://services.leadconnectorhq.com")
        assert.equal(options?.redirect, "error")
        assert.equal(options?.cache, "no-store")
        calls.push({ path: url.pathname, body, options: options! })
        let value: Record<string, unknown>
        if (url.pathname.startsWith("/locations/")) value = { location: { id: credentials.locationId, name: "Test business" } }
        else if (url.pathname === "/contacts/search") value = { contacts: [{ locationId: credentials.locationId, email: "private@example.com" }], total: metrics.contacts }
        else {
            const status = body.filters[0]?.value
            value = { opportunities: [{ locationId: credentials.locationId, status: status ?? "open", contact: { phone: "private" } }], total: metrics[status as "open"] ?? metrics.opportunities }
        }
        return Response.json(transform ? transform(url.pathname, body, value) : value)
    }
    return { fetcher, calls }
}

test("counts use six bounded requests and provider totals, including counts larger than one page", async () => {
    const fixture = providerFixture()
    assert.deepEqual(await fetchGhlMetrics(credentials, fixture.fetcher), { locationName: "Test business", metrics })
    assert.equal(fixture.calls.length, 6)
    assert.ok(fixture.calls[0].path.startsWith("/locations/"))
    for (const call of fixture.calls.slice(1)) assert.equal(call.body.limit ?? call.body.pageLimit, 1)
    assert.equal(JSON.stringify(metrics).includes("private@example"), false)
})

test("an inaccessible or mismatched location prevents all metric queries", async () => {
    const fixture = providerFixture((path, _body, value) => path.startsWith("/locations/") ? { location: { id: "different", name: "Other client" } } : value)
    await assert.rejects(fetchGhlMetrics(credentials, fixture.fetcher), (error: unknown) => error instanceof GhlError && error.code === "location")
    assert.equal(fixture.calls.length, 1)
})

test("missing totals and ignored status filters are errors, never zero or a sampled count", async () => {
    for (const kind of ["missing", "status"]) {
        const fixture = providerFixture((path, body, value) => {
            if (path === "/opportunities/search" && body.filters[0]?.value === "won") return kind === "missing" ? { opportunities: [] } : { ...value, opportunities: [{ status: "open" }] }
            return value
        })
        await assert.rejects(fetchGhlMetrics(credentials, fixture.fetcher), (error: unknown) => error instanceof GhlError && error.code === "response")
    }
})

test("real zero counts remain zero", async () => {
    const fixture = providerFixture((path, _body, value) => path === "/contacts/search" ? { contacts: [], total: 0 } : value)
    assert.equal((await fetchGhlMetrics(credentials, fixture.fetcher)).metrics.contacts, 0)
})

test("provider status errors are sanitized and do not disclose response bodies or tokens", async () => {
    for (const [status, code] of [[401, "credentials"], [403, "permissions"], [429, "rate_limit"], [500, "unavailable"]] as const) {
        await assert.rejects(fetchGhlMetrics(credentials, async () => new Response(credentials.privateToken, { status })), (error: unknown) => error instanceof GhlError && error.code === code && !error.message.includes(credentials.privateToken))
    }
    await assert.rejects(readGhlJson(Response.json({ large: "a".repeat(300000) })), GhlError)
})

test("non-TEST, revoked and missing portals never reach storage or GHL", async () => {
    for (const resolved of [null, { ...access, relationship: { id: "relationship-a", is_test: false } }, { ...access, relationship: { id: "relationship-a", is_test: "true" } }]) {
        const response = await handlePortalGhl(request({ action: "connect", ...credentials }), "session", { resolve: async () => resolved, rpc: () => { throw new Error("must not reach storage") } })
        assert.equal(response.status, 404)
    }
})

test("snapshot GET is cached-data-only and explicitly strips credentials and raw provider data", async () => {
    const response = await handlePortalGhl(new Request("https://portal.example/api"), "session", {
        resolve: async () => access,
        rpc: async (params) => { assert.equal(params.p_workspace_id, "workspace-a"); assert.equal(params.p_action, "read"); return { data: { ...connected, privateToken: credentials.privateToken, raw: "private", metrics: { ...metrics, contactsRaw: ["private"] } }, error: null } },
        fetchMetrics: async () => { throw new Error("must not query GHL") },
    })
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(await response.json(), connected)
})

test("connect obtains a lease before validating and stores only a verified connection", async () => {
    const actions: string[] = []
    const response = await handlePortalGhl(request({ action: "connect", ...credentials, workspaceId: "other" }), "session", {
        resolve: async () => access,
        rpc: async (params) => {
            assert.equal(params.p_workspace_id, "workspace-a")
            actions.push(String(params.p_action))
            if (params.p_action === "finish") { assert.equal(params.p_private_token, credentials.privateToken); assert.deepEqual(params.p_metrics, metrics) }
            return { data: params.p_action === "finish" ? connected : { accepted: true }, error: null }
        },
        fetchMetrics: async (value) => { assert.deepEqual(actions, ["begin_connect"]); assert.deepEqual(value, credentials); return { locationName: "Test business", metrics } },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(actions, ["begin_connect", "finish"])
    assert.deepEqual(await response.json(), connected)
})

test("refresh uses the scoped stored token, ignores client credentials, and never returns it", async () => {
    const response = await handlePortalGhl(request({ action: "refresh", privateToken: "wrong", locationId: "wrong" }), "session", {
        resolve: async () => access,
        rpc: async (params) => ({ data: params.p_action === "begin_refresh" ? credentials : connected, error: null }),
        fetchMetrics: async (value) => { assert.deepEqual(value, credentials); return { locationName: "Test business", metrics } },
    })
    assert.deepEqual(await response.json(), connected)
})

test("failed provider reads record a safe error without committing replacement metrics or credentials", async () => {
    const actions: Record<string, unknown>[] = []
    const response = await handlePortalGhl(request({ action: "connect", ...credentials }), "session", {
        resolve: async () => access,
        rpc: async (params) => { actions.push(params); return { data: { accepted: true }, error: null } },
        fetchMetrics: async () => { throw new GhlError("permissions") },
    })
    assert.equal(response.status, 503)
    assert.deepEqual(actions.map((value) => value.p_action), ["begin_connect", "fail"])
    assert.ok(actions.every((value) => !value.p_private_token && !value.p_metrics))
    assert.equal(actions[1].p_error, "permissions")
})

test("a disconnect racing with a refresh rejects its stale completion", async () => {
    const response = await handlePortalGhl(request({ action: "refresh" }), "session", {
        resolve: async () => access,
        rpc: async (params) => ({ data: params.p_action === "begin_refresh" ? credentials : { failure: "changed" }, error: null }),
        fetchMetrics: async () => ({ locationName: "Test business", metrics }),
    })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).connected, undefined)
})

test("cross-site, invalid and overlong writes are rejected before a lease or provider request", async () => {
    const crossSite = request({ action: "refresh" }); crossSite.headers.set("sec-fetch-site", "cross-site")
    const oversized = request({ action: "connect", privateToken: "a".repeat(9000) })
    for (const input of [crossSite, oversized, request({ action: "unknown" }), request({ action: "connect" })]) {
        const response = await handlePortalGhl(input, "session", { resolve: async () => access, rpc: () => { throw new Error("must not reach storage") } })
        assert.ok([400, 403, 413].includes(response.status))
    }
})
