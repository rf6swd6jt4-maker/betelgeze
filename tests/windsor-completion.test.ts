import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import test from "node:test"
import ts from "typescript"

function serverFixture({ connected = false, rpcError = false, reportError = false, accounts = [{ id: "one", name: "Test", datasource: "facebook_ads" }] } = {}) {
    let providerCalls = 0
    const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
    const blockId = "00000000-0000-0000-0000-000000000001"
    const fingerprint = createHash("sha256").update("integration").digest("hex")
    const connection = () => ({ status: connected ? "connected" : "pending", authorization_encrypted: connected ? null : "authorization", authorization_hash: "attempt-hash", integration_fingerprint: fingerprint, account_id: connected ? "one" : null, account_name: "Test", datasource: "facebook_ads", connected_at: connected ? "today" : null })
    const dependencies: Record<string, unknown> = {
        "node:crypto": { createHash },
        "@/lib/onboarding/canonical": { getCanonicalSessionByToken: async () => ({ session: { workspace_id: "workspace", relationship_id: "relationship", status: "active" }, steps: [{ blocks: [{ sessionBlockId: blockId, kind: "connection", provider: "meta_ads" }] }], satisfiedBlockIds: new Set(connected ? [blockId] : []) }) },
        "@/lib/windsor": { listWindsorMetaAdsAccounts: async () => { providerCalls++; return accounts }, loadWindsorMetaAdsReport: async () => { if (reportError) throw new Error("report unavailable"); return { currency: null, dateFrom: "2026-09-22", dateTo: "2026-10-21", totals: { spend: 0, impressions: 0, clicks: 0, leads: 0 }, daily: [] } } },
        "@/lib/workspace-integrations": { decryptWorkspaceIntegration: (value: string) => value === "integration" ? { api_key: "key" } : { access_token: "attempt" } },
        "@/lib/supabase/admin": { supabaseAdmin: {
            from(table: string) {
                const query = { select() { return query }, eq() { return query }, async maybeSingle() { return { error: null, data: table === "workspace_integrations" ? { enabled: true, mode: "connected", config_encrypted: "integration" } : connection() } } }
                return query
            },
            async rpc(name: string, args: Record<string, unknown>) {
                rpcCalls.push({ name, args }); connected = true
                return rpcError ? { error: { code: "P0001", message: "Already completed" } } : { data: { accountId: "one", accountName: "Test", datasource: "facebook_ads", connectedAt: "today" }, error: null }
            },
        } },
    }
    const compiled = { exports: {} as { checkWindsorMetaAdsOnboarding: (token: string, block: string, account?: string, confirmed?: boolean) => Promise<{ satisfied: boolean; preview?: unknown }> } }
    new Function("require", "module", "exports", ts.transpileModule(readFileSync("lib/onboarding/windsor-meta-ads-server.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)((name: string) => { assert.ok(name in dependencies, name); return dependencies[name] }, compiled, compiled.exports)
    return { check: (account?: string, confirmed = false) => compiled.exports.checkWindsorMetaAdsOnboarding("token", blockId, account, confirmed), rpcCalls, providerCalls: () => providerCalls }
}
test("confirmed connections survive repeated checks after the temporary token is removed", async () => {
    const fixture = serverFixture({ connected: true })
    assert.equal((await fixture.check()).satisfied, true)
    assert.equal(fixture.providerCalls(), 0); assert.equal(fixture.rpcCalls.length, 0)
})
test("a single provider account requires a report preview and explicit business confirmation", async () => {
    const fixture = serverFixture()
    assert.equal((await fixture.check()).satisfied, false)
    assert.ok((await fixture.check("one")).preview)
    assert.equal(fixture.rpcCalls.length, 0)
    assert.equal((await fixture.check("one", true)).satisfied, true)
    assert.equal(fixture.rpcCalls[0].name, "complete_verified_windsor_meta_ads_onboarding")
    assert.equal(fixture.rpcCalls[0].args.p_authorization_hash, "attempt-hash")
    assert.equal(fixture.rpcCalls[0].args.p_account_id, "one")
})
test("a concurrent successful completion is recovered without a false error", async () => {
    const fixture = serverFixture({ rpcError: true })
    assert.equal((await fixture.check("one", true)).satisfied, true)
    assert.equal(fixture.providerCalls(), 1)
})
test("missing or ambiguous accounts never manufacture success", async () => {
    const empty = serverFixture({ accounts: [] })
    assert.equal((await empty.check()).satisfied, false); assert.equal(empty.rpcCalls.length, 0)
    const multiple = serverFixture({ accounts: [{ id: "one", name: "First", datasource: "facebook_ads" }, { id: "two", name: "Second", datasource: "facebook_ads" }] })
    assert.equal((await multiple.check()).satisfied, false)
    assert.equal((await multiple.check("unauthorized")).satisfied, false)
    assert.equal(multiple.rpcCalls.length, 0)
    assert.equal((await multiple.check("two", true)).satisfied, true)
    assert.equal(multiple.rpcCalls[0].args.p_account_id, "two")
})

test("report failure cannot complete or overwrite an onboarding connection", async () => {
    const fixture = serverFixture({ reportError: true })
    await assert.rejects(fixture.check("one", true), /report unavailable/)
    assert.equal(fixture.rpcCalls.length, 0)
})
