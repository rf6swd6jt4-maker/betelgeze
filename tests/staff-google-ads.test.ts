import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import test from "node:test"
import ts from "typescript"

function compiled<T>(path: string, dependencies: Record<string, unknown>): T {
    const compiledModule = { exports: {} }
    const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("require", "module", "exports", output)((name: string) => { assert.ok(name in dependencies, name); return dependencies[name] }, compiledModule, compiledModule.exports)
    return compiledModule.exports as T
}
const state = compiled<typeof import("../lib/onboarding/google-ads-state")>("lib/onboarding/google-ads-state.ts", {})
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const identity = { workspaceId: id(1), relationshipId: id(2), userId: id(3) }
const customer = "2345678901", manager = "1234567890"
class GoogleAdsConnectionAccessError extends Error {}
class StaffGoogleAdsUnavailableError extends Error {}
const connection = { customerId: customer, managerId: manager, managerName: "Agency", status: "connected", accountName: "Client", verifiedAt: "2026-10-27T12:00:00Z" }

test("staff metadata never returns credentials and a denied source cannot reach the provider", async () => {
    let allowed = true, calls = 0
    const reads: boolean[] = []
    const api = compiled<typeof import("../lib/client-connections/google-ads-setup")>("lib/client-connections/google-ads-setup.ts", {
        "server-only": {}, "@/lib/onboarding/google-ads-state": state,
        "@/lib/google-ads/connection-server": { GoogleAdsConnectionAccessError, runGoogleAdsConnection: async () => { calls++; return connection } },
        "@/lib/supabase/admin": { supabaseAdmin: { rpc: async (name: string, args: Record<string, unknown>) => {
            assert.equal(name, "read_google_ads_staff")
            assert.equal(args.p_workspace_id, identity.workspaceId); assert.equal(args.p_user_id, identity.userId); assert.equal(args.p_relationship_id, identity.relationshipId)
            reads.push(args.p_credentials === true)
            return allowed ? { data: { connection, managerId: manager, managerName: "Agency", integrationEncrypted: "private-credential" }, error: null } : { data: null, error: { code: "42501", message: "access denied" } }
        } } },
    })
    const result = await api.loadStaffGoogleAds(identity)
    assert.equal(result.satisfied, true); assert.deepEqual(reads, [false]); assert.equal(calls, 0)
    assert.doesNotMatch(JSON.stringify(result), /private-credential|integrationEncrypted/)
    allowed = false
    await assert.rejects(api.runStaffGoogleAds(identity, customer, true), /access denied/)
    await assert.rejects(api.runStaffGoogleAds({ ...identity, relationshipId: "invalid" }, customer, true), /valid client/)
    assert.equal(calls, 0)
})

function runnerFixture(options: { beginDenied?: boolean; finishDenied?: boolean; providerFails?: boolean } = {}) {
    const rpc: { name: string; args: Record<string, unknown> }[] = []
    const provider: unknown[][] = []
    const run = async (...args: unknown[]) => { provider.push(args); if (options.providerFails) throw new Error("private provider error"); return { status: "connected", accountName: "Client", currency: "USD", timeZone: "America/Chicago" } }
    const api = compiled<typeof import("../lib/google-ads/connection-server")>("lib/google-ads/connection-server.ts", {
        "node:crypto": { randomUUID }, "@/lib/onboarding/google-ads-state": state,
        "@/lib/workspace-integrations": { decryptWorkspaceIntegration: () => ({ manager_customer_id: manager }) },
        "@/lib/google-ads": { connectGoogleAdsClient: run, normalizeGoogleAdsConfig: (value: unknown) => value, googleAdsClientError: () => "The account could not be verified.", googleAdsDiagnosticError: () => "sanitized diagnostic" },
        "@/lib/supabase/admin": { supabaseAdmin: { rpc: async (name: string, args: Record<string, unknown>) => {
            rpc.push({ name, args })
            if (name.startsWith("begin")) return options.beginDenied ? { error: { code: "42501", message: "access denied" } } : { data: { previousCustomerId: "9999999999" } }
            return options.finishDenied ? { error: { code: "42501", message: "access revoked" } } : { data: { ...connection, status: args.p_status } }
        } } },
    })
    return { api, rpc, provider }
}

test("staff run carries authenticated identity and exact config without bearer tokens or replacement", async () => {
    const f = runnerFixture()
    assert.equal((await f.api.runGoogleAdsConnection({ config_encrypted: "encrypted" }, identity, "234-567-8901", false)).status, "connected")
    assert.deepEqual(f.rpc.map(call => call.name), ["begin_google_ads_staff", "finish_google_ads_staff"])
    for (const call of f.rpc) {
        assert.equal(call.args.p_workspace_id, identity.workspaceId); assert.equal(call.args.p_user_id, identity.userId); assert.equal(call.args.p_relationship_id, identity.relationshipId)
        assert.equal(call.args.p_customer_id, customer); assert.equal(call.args.p_expected_config, "encrypted")
        assert.equal(call.args.p_token, undefined); assert.equal(call.args.p_block_id, undefined)
    }
    assert.equal(f.provider.length, 1); assert.equal(f.provider[0][2], false); assert.equal(f.provider[0][5], null)
})

test("staff begin denial prevents provider work and finish denial cannot claim connection success", async () => {
    const denied = runnerFixture({ beginDenied: true })
    await assert.rejects(denied.api.runGoogleAdsConnection({ config_encrypted: "encrypted" }, identity, customer, true), /access denied/)
    assert.equal(denied.provider.length, 0)
    const revoked = runnerFixture({ finishDenied: true })
    await assert.rejects(revoked.api.runGoogleAdsConnection({ config_encrypted: "encrypted" }, identity, customer, true), /access revoked/)
    assert.equal(revoked.provider.length, 1)
})

test("provider failure records attention without reporting a successful connection", async () => {
    const f = runnerFixture({ providerFails: true })
    await assert.rejects(f.api.runGoogleAdsConnection({ config_encrypted: "encrypted" }, identity, customer, true), /could not be verified/)
    assert.equal(f.rpc.at(-1)?.args.p_status, "needs_attention")
    assert.equal(f.rpc.at(-1)?.args.p_error, "sanitized diagnostic")
})

test("existing portal and onboarding dispatch retain their bearer scope and replacement behavior", async () => {
    for (const source of ["portal", "onboarding"] as const) {
        const f = runnerFixture()
        const scope = source === "portal" ? { token: "portal-token", workspaceId: identity.workspaceId } : { token: "onboarding-token", blockId: id(4) }
        await f.api.runGoogleAdsConnection({ config_encrypted: "encrypted" }, scope, customer, true)
        assert.deepEqual(f.rpc.map(call => call.name), [`begin_google_ads_${source}`, `finish_google_ads_${source}`])
        assert.equal(f.rpc[0].args.p_token, scope.token)
        assert.equal(f.rpc[0].args.p_expected_config, undefined)
        assert.equal(f.rpc[1].args.p_customer_id, undefined)
        assert.equal(f.provider[0][5], "9999999999")
    }
})

function routeFixture(denied = false, failure?: Error) {
    const calls: unknown[][] = []
    const http = compiled<typeof import("../lib/google-ads/http")>("lib/google-ads/http.ts", {})
    const api = compiled<typeof import("../app/api/workspaces/[workspaceSlug]/client-connections/google-ads/route")>("app/api/workspaces/[workspaceSlug]/client-connections/google-ads/route.ts", {
        "@/lib/google-ads/http": http,
        "@/lib/google-ads/connection-server": { GoogleAdsConnectionAccessError },
        "@/lib/workspace-access": { requireWorkspacePanel: async (slug: string, panel: string) => { assert.equal(slug, "fixture"); assert.equal(panel, "client-connections"); if (denied) throw new Error("denied"); return { workspace: { id: identity.workspaceId }, user: { id: identity.userId } } } },
        "@/lib/client-connections/google-ads-setup": { StaffGoogleAdsUnavailableError, loadStaffGoogleAds: async (...args: unknown[]) => { calls.push(args); if (failure) throw failure; return { connection } }, runStaffGoogleAds: async (...args: unknown[]) => { calls.push(args); if (failure) throw failure; return connection } },
    })
    const context = { params: Promise.resolve({ workspaceSlug: "fixture" }) }
    const post = (body: unknown, origin = "https://example.com") => api.POST(new Request("https://example.com/api/workspaces/fixture/client-connections/google-ads", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) }), context)
    return { api, calls, context, post }
}

test("staff endpoint derives actor/workspace from session and requires explicit invitation consent", async () => {
    const f = routeFixture()
    const body = { relationshipId: identity.relationshipId, customerId: customer, action: "request", userId: id(99), workspaceId: id(98) }
    assert.equal((await f.post(body)).status, 400); assert.equal(f.calls.length, 0)
    assert.equal((await f.post({ ...body, consented: true })).status, 200)
    assert.deepEqual(f.calls[0], [identity, customer, true])
    assert.equal((await f.post({ ...body, action: "verify" })).status, 200)
    assert.deepEqual(f.calls[1], [identity, customer, false])
})

test("cross-origin, oversized, forged actions and denied panel requests never dispatch a connection", async () => {
    const f = routeFixture()
    const body = { relationshipId: identity.relationshipId, customerId: customer, action: "request", consented: true }
    assert.equal((await f.post(body, "https://other.example")).status, 400)
    assert.equal((await f.post({ ...body, padding: "x".repeat(3000) })).status, 400)
    assert.equal((await f.post({ ...body, action: "disconnect" })).status, 400)
    assert.equal(f.calls.length, 0)
    const denied = routeFixture(true)
    assert.equal((await denied.post(body)).status, 403)
    const result = await denied.api.GET(new Request(`https://example.com/?relationship=${identity.relationshipId}`), denied.context)
    assert.equal(result.status, 403); assert.equal(denied.calls.length, 0)
})


test("lost setup authority is forbidden and unavailable integration cannot appear ready", async () => {
    const body = { relationshipId: identity.relationshipId, customerId: customer, action: "verify" }
    for (const [failure, expected] of [[new GoogleAdsConnectionAccessError("access revoked"), 403], [new StaffGoogleAdsUnavailableError("Connect agency first"), 503]] as const) {
        const f = routeFixture(false, failure)
        assert.equal((await f.post(body)).status, expected)
        const response = await f.api.GET(new Request(`https://example.com/?relationship=${identity.relationshipId}`), f.context)
        assert.equal(response.status, expected)
        assert.equal(response.headers.get("Cache-Control"), "private, no-store")
    }
})
