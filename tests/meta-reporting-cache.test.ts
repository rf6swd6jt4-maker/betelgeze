import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import test from "node:test"
import ts from "typescript"
import type { PortalMetaAdsReport } from "../lib/client-portal/meta-ads-report"

const now = new Date()
const report: PortalMetaAdsReport = { accountId: "account", accountName: "Business", connectionRevision: "revision", fetchedAt: now.toISOString(), period: "last_30d", dateFrom: "2026-09-22", dateTo: now.toISOString().slice(0, 10), currency: "USD", totals: { spend: 12, impressions: 100, clicks: 4, leads: 0, ctr: 4, cpc: 3, costPerLead: null }, daily: [{ date: now.toISOString().slice(0, 10), spend: 12, impressions: 100, clicks: 4, leads: 0 }] }
function fixture({ retained = report as PortalMetaAdsReport | null, allowed = true, providerFails = false, saved = true, integrationEnabled = true, providerWait = Promise.resolve() } = {}) {
    let reads = 0, providerCalls = 0
    const writes: Record<string, unknown>[] = []
    const fingerprint = createHash("sha256").update("integration").digest("hex")
    const parser = { exports: {} as Record<string, unknown> }
    const compile = (file: string) => ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("module", "exports", compile("lib/client-portal/meta-ads-report.ts"))(parser, parser.exports)
    const deps: Record<string, unknown> = {
        "server-only": {}, "node:crypto": { createHash },
        "@/lib/client-portal/session": { resolveClientPortalAccessByToken: async () => allowed ? { workspace: { id: "workspace" }, relationship: { id: "relationship" } } : null },
        "@/lib/client-portal/meta-ads-report": parser.exports,
        "@/lib/workspace-integrations": { decryptWorkspaceIntegration: () => ({ api_key: "key" }) },
        "@/lib/windsor": { loadWindsorMetaAdsReport: async () => { providerCalls++; await providerWait; if (providerFails) throw new Error("provider failed"); return { ...report, totals: { ...report.totals, spend: 25 } } } },
        "@/lib/supabase/admin": { supabaseAdmin: {
            from(table: string) {
                reads++
                const query = { select() { return query }, eq() { return query }, async maybeSingle() { return { error: null, data: table === "workspace_integrations" ? { enabled: integrationEnabled, mode: "connected", config_encrypted: "integration" } : { id: "id", account_id: "account", account_name: "Business", reporting_revision: "revision", reporting_verified_at: now.toISOString(), integration_fingerprint: fingerprint, last_report: retained, last_report_error: null } } } }
                return query
            },
            async rpc(_name: string, args: Record<string, unknown>) { writes.push(args); return { data: saved, error: null } },
        } },
    }
    const compiled = { exports: {} as { loadPortalMetaAdsReport: (token: string, refresh?: boolean) => Promise<PortalMetaAdsReport | null> } }
    new Function("require", "module", "exports", compile("lib/client-portal/meta-ads-server.ts"))((name: string) => { assert.ok(name in deps, name); return deps[name] }, compiled, compiled.exports)
    return { load: compiled.exports.loadPortalMetaAdsReport, reads: () => reads, providerCalls: () => providerCalls, writes }
}

test("portal authorization precedes all report reads", async () => {
    const f = fixture({ allowed: false })
    assert.equal(await f.load("revoked"), null); assert.equal(f.reads(), 0); assert.equal(f.providerCalls(), 0)
})
test("fresh retained reports paint without a provider call or write", async () => {
    const f = fixture()
    const result = await f.load("token")
    assert.equal(result?.totals.spend, 12); assert.equal(result?.freshness, "current")
    assert.equal(f.providerCalls(), 0); assert.equal(f.writes.length, 0); assert.equal(f.reads(), 2)
})
test("an uncached first load returns provider figures without adding a save round trip", async () => {
    const f = fixture({ retained: null, saved: false })
    assert.equal((await f.load("token"))?.totals.spend, 25)
    assert.equal(f.providerCalls(), 1); assert.equal(f.writes.length, 0)
})
test("a rolled date range is stale even when the report was retrieved recently", async () => {
    const f = fixture({ retained: { ...report, dateTo: "2000-01-01" } })
    assert.equal((await f.load("token"))?.freshness, "stale"); assert.equal(f.providerCalls(), 0)
})
test("a disabled integration cannot make retained figures look current", async () => {
    const f = fixture({ integrationEnabled: false })
    assert.equal((await f.load("token"))?.freshness, "stale")
    assert.equal((await f.load("token", true))?.freshness, "stale"); assert.equal(f.providerCalls(), 0)
})
test("provider failure retains the exact successful timestamp and figures", async () => {
    const f = fixture({ providerFails: true })
    const result = await f.load("token", true)
    assert.equal(result?.freshness, "stale"); assert.equal(result?.fetchedAt, report.fetchedAt); assert.equal(result?.totals.spend, 12)
    assert.equal(f.writes[0].p_report, null); assert.equal(f.writes[0].p_error, "unavailable")
})
test("failure without retained figures is an error rather than a manufactured zero report", async () => {
    const f = fixture({ retained: null, providerFails: true })
    await assert.rejects(f.load("token"), /unavailable/)
    assert.equal(f.writes.length, 0)
})
test("retained data from another account or revision is not reused", async () => {
    for (const change of [{ accountId: "other" }, { connectionRevision: "old" }]) {
        const f = fixture({ retained: { ...report, ...change }, providerFails: true })
        await assert.rejects(f.load("token"), /unavailable/)
    }
})
test("a connection change during provider work rejects the late result", async () => {
    const f = fixture({ saved: false })
    await assert.rejects(f.load("token", true), /changed/)
    assert.equal(f.writes.length, 1)
})
test("concurrent authorized refreshes share one provider read and one CAS save", async () => {
    let release!: () => void
    const providerWait = new Promise<void>(resolve => { release = resolve })
    const f = fixture({ providerWait })
    const a = f.load("first-portal-token", true), b = f.load("second-authorized-token", true)
    await new Promise(resolve => setImmediate(resolve)); assert.equal(f.providerCalls(), 1)
    release()
    const [one, two] = await Promise.all([a, b])
    assert.equal(one?.totals.spend, 25); assert.deepEqual(one, two); assert.equal(f.writes.length, 1)
})
test("an explicit refresh cannot piggyback a read-only first load and skip its save", async () => {
    let release!: () => void
    const providerWait = new Promise<void>(resolve => { release = resolve })
    const f = fixture({ retained: null, providerWait })
    const read = f.load("token"), refresh = f.load("token", true)
    await new Promise(resolve => setImmediate(resolve)); assert.equal(f.providerCalls(), 2)
    release()
    const [one, two] = await Promise.all([read, refresh])
    assert.equal(one?.totals.spend, 25); assert.equal(two?.totals.spend, 25)
    assert.equal(f.writes.length, 1); assert.ok(f.writes[0].p_report)
})
