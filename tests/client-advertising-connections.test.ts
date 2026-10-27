import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

function compile<T>(path: string, dependencies: Record<string, unknown>): T {
    const compiled = { exports: {} }
    new Function("require", "module", "exports", ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)((name: string) => {
        assert.ok(name in dependencies, name); return dependencies[name]
    }, compiled, compiled.exports)
    return compiled.exports as T
}
const uuid = "00000000-0000-4000-8000-000000000001"
function routeFixture({ denied = false, readFailure = false } = {}) {
    const calls: unknown[][] = []
    class AdvertisingConnectionAccessError extends Error {}
    const route = compile<{ GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }): Promise<Response> }>("app/api/workspaces/[workspaceSlug]/client-connections/advertising/route.ts", {
        "@/lib/workspace-access": { requireWorkspacePanel: async () => { if (denied) throw new Error("Denied"); return { workspace: { id: "trusted-workspace" }, user: { id: "trusted-actor" } } } },
        "@/lib/client-advertising-connections": { AdvertisingConnectionAccessError, readClientAdvertisingConnections: async (...args: unknown[]) => { calls.push(args); if (readFailure) throw new AdvertisingConnectionAccessError(); return { accounts: [], nextCursor: null } } },
    })
    return { calls, get: (query = "") => route.GET(new Request(`https://example.test/api?${query}`), { params: Promise.resolve({ workspaceSlug: "fixture" }) }) }
}
test("provider summary GET uses the authenticated actor and paired cursor without allowing identity overrides", async () => {
    const f = routeFixture()
    const response = await f.get(`relationship=${uuid}&after=${uuid}&provider=windsor&userId=attacker&workspaceId=other`)
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(f.calls, [["trusted-workspace", "trusted-actor", uuid, { relationshipId: uuid, provider: "windsor" }]])
})
test("invalid cursors and scope values never start a database read", async () => {
    for (const query of [`after=${uuid}`, "provider=windsor", `after=${uuid}&provider=unknown`, "relationship=invalid", "relationship="]) {
        const f = routeFixture(); assert.equal((await f.get(query)).status, 400); assert.equal(f.calls.length, 0)
    }
})
test("panel denial and permission loss use 403 so the mounted list clears private summaries", async () => {
    const denied = routeFixture({ denied: true }); assert.equal((await denied.get()).status, 403); assert.equal(denied.calls.length, 0)
    const revoked = routeFixture({ readFailure: true }); assert.equal((await revoked.get()).status, 403)
})
type SummaryServer = {
    AdvertisingConnectionAccessError: new (...args: unknown[]) => Error
    readClientAdvertisingConnections(workspace: string, actor: string, relationship?: string, cursor?: { relationshipId: string; provider: string }): Promise<{ accounts: { relationshipId: string; provider: string; archived: boolean; clientName: string; businessName: string | null }[]; nextCursor: { relationshipId: string; provider: string } | null }>
}
function summaryFixture(data: unknown, error: unknown = null) {
    const calls: unknown[][] = []
    const server = compile<SummaryServer>("lib/client-advertising-connections.ts", { "server-only": {}, "@/lib/supabase/admin": { supabaseAdmin: { rpc: async (...args: unknown[]) => { calls.push(args); return { data, error } } } } })
    return { server, calls, read: (relationship?: string, cursor?: { relationshipId: string; provider: string }) => server.readClientAdvertisingConnections("workspace", "actor", relationship, cursor) }
}
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const tuple = (index = 0): unknown[] => [id(100 + Math.floor(index / 3)), ["google_ads", "meta_ads", "windsor"][index % 3], `O'Brien \"North\" İstanbul 😀`, null, "connected", "account", "Account", "2026-10-27T12:00:00+00:00", null]

test("the summary server uses one private current RPC with the trusted actor and paired cursor", async () => {
    const f = summaryFixture([]), cursor = { relationshipId: uuid, provider: "windsor" }
    assert.deepEqual(await f.read(uuid, cursor), { accounts: [], nextCursor: null })
    assert.deepEqual(f.calls, [["read_current_client_advertising_connections", { p_workspace_id: "workspace", p_user_id: "actor", p_relationship_id: uuid, p_after_relationship: uuid, p_after_provider: "windsor" }]])
})
test("compact metadata tuples decode to the public objects without private tuple or credential fields", async () => {
    const f = summaryFixture([tuple()]), page = await f.read()
    assert.deepEqual(page, { accounts: [{ relationshipId: id(100), provider: "google_ads", clientName: `O'Brien \"North\" İstanbul 😀`, businessName: null, archived: false, status: "connected", accountId: "account", accountName: "Account", connectedAt: "2026-10-27T12:00:00+00:00", verifiedAt: null }], nextCursor: null })
})
test("only a 51st row creates the cursor, using visible row 50 even within one relationship", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => tuple(index))
    const page = await summaryFixture(rows).read()
    assert.equal(page.accounts.length, 50)
    assert.deepEqual(page.nextCursor, { relationshipId: id(116), provider: "meta_ads" })
    assert.equal((await summaryFixture(rows.slice(0, 50)).read()).nextCursor, null)
    const continued = await summaryFixture(rows.slice(50)).read(undefined, page.nextCursor!)
    assert.deepEqual(continued.accounts.map(row => [row.relationshipId, row.provider]), [[id(116), "windsor"]])
})
test("access loss stays typed while transport, failure envelopes, and malformed metadata fail closed", async () => {
    const denied = summaryFixture({ failure: "access" })
    await assert.rejects(denied.read(), denied.server.AdvertisingConnectionAccessError)
    for (const data of [null, {}, { accounts: [], nextCursor: null }, { failure: "cursor" }, Array.from({ length: 52 }, (_, index) => tuple(index)), [tuple().slice(0, 8)], [[...tuple(), "extra"]]]) {
        await assert.rejects(summaryFixture(data).read(), /could not be loaded/)
    }
    for (const [index, value] of [[0, "invalid"], [1, "unknown"], [2, null], [3, 7], [4, "unknown"], [5, {}], [6, []], [7, "not-a-date"], [8, 1]] as const) {
        const malformed = tuple(); malformed[index] = value
        await assert.rejects(summaryFixture([malformed]).read(), /could not be loaded/)
    }
    const rows = Array.from({ length: 51 }, (_, index) => tuple(index)); rows[50][4] = "invalid"
    await assert.rejects(summaryFixture(rows).read(), /could not be loaded/, "Lookahead is validated too")
    await assert.rejects(summaryFixture([], { message: "transport" }).read(), /could not be loaded/)
})
test("duplicate, out-of-order, stale-cursor and wrong-scope rows cannot create an unsafe continuation", async () => {
    for (const rows of [[tuple(1), tuple(0)], [tuple(0), tuple(0)]]) await assert.rejects(summaryFixture(rows).read(), /could not be loaded/)
    await assert.rejects(summaryFixture([tuple(0)]).read(id(200)), /could not be loaded/)
    await assert.rejects(summaryFixture([tuple(0)]).read(undefined, { relationshipId: id(100), provider: "google_ads" }), /could not be loaded/)
})
