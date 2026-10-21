import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import test from "node:test"
import ts from "typescript"

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const identity = { workspaceId: id(1), relationshipId: id(2), userId: id(3) }
const fingerprint = createHash("sha256").update("integration").digest("hex")
function fixture({ candidateId = id(5), allowed = true, reportFails = false } = {}) {
    const commands: { action: string; input: Record<string, unknown> }[] = []
    const providerCalls: string[] = []
    const state = { revision: id(4), integrationEncrypted: "integration", grantEncrypted: "grant", candidate: { id: candidateId, integration_fingerprint: fingerprint, authorization_encrypted: "grant" } }
    const deps: Record<string, unknown> = {
        "server-only": {}, "node:crypto": { createHash, randomUUID },
        "@/lib/supabase/admin": { supabaseAdmin: { async rpc(_name: string, args: { p_action: string; p_input: Record<string, unknown> }) {
            commands.push({ action: args.p_action, input: args.p_input })
            if (!allowed) return { error: { code: "42501", message: "access denied" } }
            return { data: args.p_action === "context" ? state : { saved: true, candidateId: args.p_input.candidateId }, error: null }
        } } },
        "@/lib/workspace-integrations": { decryptWorkspaceIntegration: (value: string) => value === "integration" ? { api_key: "secret-key" } : { access_token: "client-token" }, encryptIntegrationCredential: () => "encrypted-grant" },
        "@/lib/windsor": {
            createWindsorMetaAdsAuthorization: async () => { providerCalls.push("authorization"); return { accessToken: "client-token", authorizationUrl: "https://onboard.windsor.ai/fixture" } },
            listWindsorMetaAdsAccounts: async (key: string, token: string) => { assert.equal(key, "secret-key"); assert.equal(token, "client-token"); providerCalls.push("accounts"); return [{ id: "client-account", name: "Client business", datasource: "facebook" }] },
            loadWindsorMetaAdsReport: async (_key: string, account: string) => { providerCalls.push(`report:${account}`); if (reportFails) throw new Error("invalid report"); return { daily: [], totals: { spend: 0 }, dateFrom: "2026-09-22", dateTo: "2026-10-21" } },
        },
    }
    type Operation = (...args: unknown[]) => Promise<Record<string, unknown>>
    const compiled = { exports: {} as { beginMetaReportingMaintenance: Operation; listMetaReportingCandidates: Operation; previewMetaReportingCandidate: Operation; commitMetaReportingCandidate: Operation } }
    new Function("require", "module", "exports", ts.transpileModule(readFileSync("lib/client-connections/meta-ads-maintenance.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)((name: string) => { assert.ok(name in deps, name); return deps[name] }, compiled, compiled.exports)
    return { ...compiled.exports, commands, providerCalls }
}

test("maintenance authorization is checked before provider reads or client-grant reuse", async () => {
    const f = fixture({ allowed: false })
    await assert.rejects(f.beginMetaReportingMaintenance(identity, id(4), true), /access/)
    assert.deepEqual(f.providerCalls, [])
})
test("a replaced revision cannot prepare a new authorization", async () => {
    const f = fixture()
    await assert.rejects(f.beginMetaReportingMaintenance(identity, id(9), true), /changed/)
    assert.deepEqual(f.providerCalls, [])
})
test("new authorization is stored as a separate encrypted candidate and does not change the live binding", async () => {
    const f = fixture()
    const result = await f.beginMetaReportingMaintenance(identity, id(4), true)
    assert.equal(result.authorizationUrl, "https://onboard.windsor.ai/fixture")
    assert.equal(f.commands.at(-1)?.action, "begin")
    assert.equal(f.commands.at(-1)?.input.authorizationEncrypted, "encrypted-grant")
    assert.equal(f.commands.at(-1)?.input.expectedRevision, id(4))
    assert.equal(JSON.stringify(result).includes("client-token"), false)
})
test("retained client authorization can be reviewed without creating a new provider link", async () => {
    const f = fixture()
    assert.equal((await f.beginMetaReportingMaintenance(identity, id(4), false)).authorizationUrl, null)
    assert.deepEqual(f.providerCalls, [])
})
test("a candidate from another attempt cannot reveal provider accounts", async () => {
    const f = fixture()
    await assert.rejects(f.listMetaReportingCandidates(identity, id(8)), /expired|replaced/)
    assert.deepEqual(f.providerCalls, [])
})
test("agency-visible accounts outside the client authorization cannot be previewed", async () => {
    const f = fixture()
    await assert.rejects(f.previewMetaReportingCandidate(identity, id(5), "other-client"), /not included/)
    assert.deepEqual(f.providerCalls, ["accounts"])
    assert.equal(f.commands.some(c => c.action === "preview"), false)
})
test("valid zero reports can be previewed but failure cannot manufacture verification", async () => {
    const f = fixture()
    const result = await f.previewMetaReportingCandidate(identity, id(5), "client-account")
    assert.ok(result.report)
    assert.deepEqual(f.providerCalls, ["accounts", "report:client-account"])
    assert.equal(f.commands.at(-1)?.input.integrationFingerprint, fingerprint)
    const failed = fixture({ reportFails: true })
    await assert.rejects(failed.previewMetaReportingCandidate(identity, id(5), "client-account"), /invalid report/)
    assert.equal(failed.commands.some(c => c.action === "preview"), false)
})
test("confirmation sends only the preview identity and revision to the durable command", async () => {
    const f = fixture()
    await f.commitMetaReportingCandidate(identity, id(5), "client-account", id(4))
    assert.deepEqual(f.providerCalls, [])
    assert.equal(f.commands.at(-1)?.action, "commit")
    assert.equal(f.commands.at(-1)?.input.expectedRevision, id(4))
    assert.equal(f.commands.at(-1)?.input.report, undefined)
})
