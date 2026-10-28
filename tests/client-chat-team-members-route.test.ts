import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const code = ts.transpileModule(readFileSync("app/api/workspaces/[workspaceSlug]/communications/participants/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function fixture(error: { message: string; code: string } | null = null) {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const modules: Record<string, unknown> = {
        "@/lib/workspace-access": { requireWorkspacePanel: async (slug: string, panel: string) => { assert.equal(slug, "test"); assert.equal(panel, "communications"); return { workspace: { id: id(1) }, user: { id: id(2) } } } },
        "@/lib/supabase/admin": { supabaseAdmin: { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: { memberIds: [id(4)] }, error } } } },
        "@/lib/communications/access": { clientConversationParticipants: async () => { throw new Error("Redundant post-save roster read") } },
    }
    const compiled = { exports: {} as Record<"GET" | "POST", (request: Request, context: unknown) => Promise<Response>> }
    new Function("require", "module", "exports", code)((name: string) => { assert.ok(name in modules); return modules[name] }, compiled, compiled.exports)
    const context = { params: Promise.resolve({ workspaceSlug: "test" }) }
    return { calls, get: (teamId = id(3)) => compiled.exports.GET(new Request(`https://fixture/participants?teamId=${teamId}`), context),
        post: (input: unknown) => compiled.exports.POST(new Request("https://fixture/participants", { method: "POST", body: JSON.stringify(input) }), context) }
}

test("View/Edit saves use session authority, one committed RPC, and no roster reads", async () => {
    const f = fixture()
    const saved = await f.post({ operation: "setPermissions", relationshipId: id(3), viewIds: [id(4), id(5)], viewOnlyIds: [id(5)], workspaceId: id(8), actorUserId: id(9) })
    assert.equal(saved.status, 200)
    assert.deepEqual(await saved.json(), { ok: true })
    assert.equal(saved.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(f.calls, [{ name: "set_client_chat_permissions", args: { p_workspace_id: id(1), p_relationship_id: id(3), p_actor_user_id: id(2), p_view_ids: [id(4), id(5)], p_view_only_ids: [id(5)] } }])
    const denied = await fixture({ message: "Only the assigned manager can change access", code: "42501" }).post({ operation: "setPermissions", relationshipId: id(3), viewIds: [], viewOnlyIds: [] })
    assert.equal(denied.status, 403)
})

test("View/Edit input requires bounded UUID arrays and Edit implies View", async () => {
    const f = fixture()
    for (const input of [{ viewIds: [], viewOnlyIds: [id(4)] }, { viewIds: [null], viewOnlyIds: [] }, { viewIds: [id(4)], viewOnlyIds: null }, { viewIds: Array(1001).fill(id(4)), viewOnlyIds: [] }, { viewIds: ["bad"], viewOnlyIds: [] }]) {
        assert.equal((await f.post({ operation: "setPermissions", relationshipId: id(3), ...input })).status, 400)
    }
    assert.deepEqual(f.calls, [])
})

test("existing full-access saves omit the empty exception array through the API and RPC", async () => {
    const f = fixture()
    const saved = await f.post({ relationshipId: id(3), viewIds: [id(4)] })
    assert.equal(saved.status, 200)
    assert.deepEqual(f.calls, [{ name: "set_client_chat_permissions", args: { p_workspace_id: id(1), p_relationship_id: id(3), p_actor_user_id: id(2), p_view_ids: [id(4)] } }])
})

test("Team roster read and additive write use session authority and one scoped RPC", async () => {
    const f = fixture()
    const response = await f.get()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    const saved = await f.post({ operation: "addFromTeam", teamId: id(3), userIds: [id(4)], workspaceId: id(8), actorUserId: id(9), relationshipId: id(10) })
    assert.equal(saved.status, 200)
    assert.deepEqual(await saved.json(), { memberIds: [id(4)] })
    assert.deepEqual(f.calls, [
        { name: "read_team_client_chat_members", args: { p_workspace_id: id(1), p_team_id: id(3), p_actor_user_id: id(2) } },
        { name: "add_team_client_chat_members", args: { p_workspace_id: id(1), p_team_id: id(3), p_actor_user_id: id(2), p_user_ids: [id(4)] } },
    ])
})

test("invalid and oversized Team requests never reach the membership owner", async () => {
    const f = fixture()
    assert.equal((await f.get("-".repeat(36))).status, 400)
    for (const userIds of [[], [null], ["bad"], Array(201).fill(id(4)), "bad"]) assert.equal((await f.post({ operation: "addFromTeam", teamId: id(3), userIds })).status, 400)
    assert.equal((await f.post({ operation: "addFromTeam", teamId: "bad", userIds: [id(4)] })).status, 400)
    assert.deepEqual(f.calls, [])
})

test("database permission rejection never reports saved membership", async () => {
    const f = fixture({ message: "Only this client’s assigned manager can add people to Client chat", code: "42501" })
    assert.equal((await f.get()).status, 403)
    const response = await f.post({ operation: "addFromTeam", teamId: id(3), userIds: [id(4)] })
    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), { error: "Only this client’s assigned manager can add people to Client chat" })
})

test("existing Client participant saves acknowledge the committed RPC without rereading the roster", async () => {
    const f = fixture()
    const response = await f.post({ relationshipId: id(3), userIds: [id(4)] })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(f.calls, [{ name: "set_client_chat_members", args: { p_workspace_id: id(1), p_relationship_id: id(3), p_actor_user_id: id(2), p_user_ids: [id(4)] } }])
    const denied = await fixture({ message: "Permission denied", code: "42501" }).post({ relationshipId: id(3), userIds: [id(4)] })
    assert.equal(denied.status, 403)
    assert.deepEqual(await denied.json(), { error: "Permission denied" })
})
