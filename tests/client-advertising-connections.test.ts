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
test("the summary server makes one bounded RPC and never selects credential columns", async () => {
    const calls: unknown[] = []
    const server = compile<{ readClientAdvertisingConnections(workspace: string, actor: string): Promise<unknown> }>("lib/client-advertising-connections.ts", { "server-only": {}, "@/lib/supabase/admin": { supabaseAdmin: { rpc: async (...args: unknown[]) => { calls.push(args); return { data: { accounts: [], nextCursor: null }, error: null } } } } })
    await server.readClientAdvertisingConnections("workspace", "actor")
    assert.deepEqual(calls, [["read_client_advertising_connections", { p_workspace_id: "workspace", p_user_id: "actor", p_relationship_id: null, p_after_relationship: null, p_after_provider: null }]])
})
