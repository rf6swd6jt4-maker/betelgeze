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
    class ClientConnectionRelationshipsAccessError extends Error {}
    const route = compile<{ GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }): Promise<Response> }>("app/api/workspaces/[workspaceSlug]/client-connections/relationships/route.ts", {
        "@/lib/workspace-access": { requireWorkspacePanel: async () => { if (denied) throw new Error("Denied"); return { workspace: { id: "trusted-workspace" }, user: { id: "trusted-actor" } } } },
        "@/lib/client-connection-relationships": { ClientConnectionRelationshipsAccessError, readClientConnectionRelationships: async (...args: unknown[]) => { calls.push(args); if (readFailure) throw new ClientConnectionRelationshipsAccessError(); return { accounts: [], nextCursor: null } } },
    })
    return { calls, get: (query = "provider=ghl") => route.GET(new Request(`https://example.test/api?${query}`), { params: Promise.resolve({ workspaceSlug: "fixture" }) }) }
}
test("relationship chooser binds trusted identity and exact callback recovery scope", async () => {
    const f = routeFixture()
    const response = await f.get(`provider=ghl&query=Jason&after=${uuid}&relationship=${uuid}&userId=attacker&workspaceId=other`)
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(f.calls, [["trusted-workspace", "trusted-actor", "ghl", "Jason", uuid, uuid]])
})
test("invalid provider, search and cursors do not start a read", async () => {
    for (const query of ["", "provider=windsor", "provider=ghl&after=bad", "provider=ghl&relationship=", `provider=meta_ads&query=${"x".repeat(101)}`]) {
        const f = routeFixture(); assert.equal((await f.get(query)).status, 400); assert.equal(f.calls.length, 0)
    }
})
test("chooser access loss uses a private 403 response", async () => {
    const denied = routeFixture({ denied: true }); const response = await denied.get(); assert.equal(response.status, 403); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(denied.calls.length, 0)
    const revoked = routeFixture({ readFailure: true }); assert.equal((await revoked.get()).status, 403)
})
test("chooser is one metadata RPC with cursor and targeted relationship passed explicitly", async () => {
    const calls: unknown[] = []
    const server = compile<{ readClientConnectionRelationships(workspace: string, actor: string, provider: string, query: string, after: string, relationship: string): Promise<unknown> }>("lib/client-connection-relationships.ts", { "server-only": {}, "@/lib/supabase/admin": { supabaseAdmin: { rpc: async (...args: unknown[]) => { calls.push(args); return { data: { accounts: [], nextCursor: null }, error: null } } } } })
    await server.readClientConnectionRelationships("workspace", "actor", "google_ads", "North", uuid, uuid)
    assert.deepEqual(calls, [["read_client_connection_relationships", { p_workspace_id: "workspace", p_user_id: "actor", p_provider: "google_ads", p_query: "North", p_after: uuid, p_relationship_id: uuid }]])
})
