import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import ts from "typescript"
import * as formatting from "../lib/chat-formatting.ts"

// Run the actual server handlers with a small database double. No production
// messages, accounts, or credentials are involved in these contract checks.
function loadServer(path: string, dependencies: Record<string, unknown>) {
    const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const localRequire = createRequire(resolve(path))
    const compiled = new Module(resolve(path)) as Module & { _compile: (source: string, filename: string) => void }
    compiled.require = ((name: string) => name === "server-only" ? {} : name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiled.require
    compiled._compile(source, path)
    return compiled.exports
}
const id = "00000000-0000-4000-8000-000000000001"
function fixture() {
    let body = "[ ] First\n[ ] Second"
    let version = "cipher-1"
    let writes = 0
    const audits: Record<string, unknown>[] = []
    const filters: [string, unknown][] = []
    const admin = {
        from(table: string) {
            const constraints: [string, unknown][] = []
            let patch: { body: string } | null = null
            const query = {
                select() { return query },
                eq(key: string, value: unknown) { constraints.push([key, value]); filters.push([key, value]); return query },
                is(key: string, value: unknown) { constraints.push([key, value]); return query },
                update(value: { body: string }) { patch = value; return query },
                async maybeSingle() {
                    assert.equal(table, "workspace_native_messages")
                    if (constraints.some(([key, value]) => (key === "workspace_id" && value !== "workspace") || (key === "conversation_id" && value !== "conversation"))) return { data: null, error: null }
                    if (!patch) return { data: { id, body: null, body_ciphertext: version, created_at: "2026-09-07T00:00:00Z" }, error: null }
                    assert.deepEqual(Object.keys(patch), ["body"])
                    const expectedVersion = constraints.find(([key]) => key === "body_ciphertext")?.[1]
                    if (expectedVersion !== version) return { data: null, error: null }
                    body = patch.body; version = `cipher-${++writes + 1}`
                    return { data: { id }, error: null }
                },
            }
            return query
        },
    }
    const service = loadServer("lib/communications/checklists.ts", {
        "@/lib/chat-formatting": formatting,
        "@/lib/supabase/admin": { supabaseAdmin: admin },
        "@/lib/admin/activity": { recordAdminActivity: async (event: Record<string, unknown>) => { audits.push(event); return true } },
    })
    const input = { messageId: id, line: 0, checked: true, expectedBody: body, workspaceId: "workspace", scopeId: "conversation", kind: "native", actorUserId: "actor", loadBody: async () => body }
    return { service, input, audits, filters, getBody: () => body, getWrites: () => writes, change: (value: string) => { body = value; version += "-concurrent" } }
}

test("checkbox writes persist only the validated marker and audit the actor", async () => {
    const f = fixture()
    const result = await f.service.updateChatCheckbox(f.input)
    assert.equal(result.body, "[x] First\n[ ] Second")
    assert.equal(f.getBody(), result.body)
    assert.equal(f.getWrites(), 1)
    assert.equal(f.audits[0].actorUserId, "actor")
    assert.equal(f.audits[0].eventKey, "chat.checkbox.changed")
    assert.ok(!JSON.stringify(f.audits).includes("First"))
    assert.ok(f.filters.some(([key]) => key === "body_ciphertext"))
    await f.service.updateChatCheckbox(f.input)
    assert.equal(f.getWrites(), 1, "setting the same state is idempotent")
})

test("concurrent toggles on different items are preserved by compare-and-swap", async () => {
    const f = fixture()
    let first = true
    const result = await f.service.updateChatCheckbox({ ...f.input, loadBody: async () => {
        const old = f.getBody()
        if (first) { first = false; f.change("[ ] First\n[x] Second") }
        return old
    } })
    assert.equal(result.body, "[x] First\n[x] Second")
    assert.equal(f.getWrites(), 1)
})

test("changed wording and wrong conversation scopes fail without writes", async () => {
    const f = fixture()
    f.change("[ ] Renamed\n[ ] Second")
    await assert.rejects(f.service.updateChatCheckbox(f.input), { status: 409 })
    await assert.rejects(f.service.updateChatCheckbox({ ...f.input, scopeId: "another-conversation" }), { status: 404 })
    await assert.rejects(f.service.updateChatCheckbox({ ...f.input, workspaceId: "another-workspace" }), { status: 404 })
    assert.equal(f.getWrites(), 0)
    for (const invalid of [{ ...f.input, line: -1 }, { ...f.input, checked: "yes" }, { ...f.input, expectedBody: "ordinary text" }]) assert.equal(f.service.checkboxInput(invalid), null)
})

test("native nonparticipants and invalid portal tokens cannot update checklists", async () => {
    let calls = 0
    const f = fixture()
    const native = loadServer("app/api/workspaces/[workspaceSlug]/communications/native/checklist/route.ts", {
        "@/lib/workspace-access": { requireWorkspacePanel: async () => ({ workspace: { id: "workspace" }, user: { id: "actor" } }) },
        "@/lib/teams/server": { assertNativeConversationAccess: async (_scope: string, _user: string, mode: string) => { assert.equal(mode, "write"); return false } },
        "@/lib/communications/checklists": { ...f.service, updateChatCheckbox: async () => { calls++ } },
    })
    const response = await native.PATCH(new Request("https://example.test/checklist", { method: "PATCH", body: JSON.stringify({ ...f.input, conversationId: id }) }), { params: Promise.resolve({ workspaceSlug: "test" }) })
    assert.equal(response.status, 403)
    const portal = loadServer("app/api/client-portal/session/[token]/checklist/route.ts", {
        "@/lib/client-portal/session": { resolveClientPortalAccessByToken: async () => null },
        "@/lib/supabase/admin": {},
        "@/lib/communications/checklists": { ...f.service, updateChatCheckbox: async () => { calls++ } },
    })
    assert.equal((await portal.PATCH(new Request("https://example.test/checklist", { method: "PATCH" }), { params: Promise.resolve({ token: "revoked" }) })).status, 404)
    assert.equal(calls, 0)
})

test("workspace checklist acknowledgements use the saved body without a fallible second reload", async () => {
    for (const kind of ["native", "client"]) {
        let reads = 0
        const body = "[ ] First", savedBody = "[x] First"
        const message = { id, body, conversationId: id, relationshipId: id, status: "sent" }
        const loadMessage = async () => {
            if (++reads > 1) throw new Error("Unrelated message reload failed")
            return message
        }
        const query = { select: () => query, eq: () => query, neq: () => query, maybeSingle: async () => ({ data: { id }, error: null }) }
        const f = fixture()
        const route = loadServer(`app/api/workspaces/[workspaceSlug]/communications/${kind === "native" ? "native/" : ""}checklist/route.ts`, {
            "@/lib/workspace-access": { requireWorkspacePanel: async () => ({ workspace: { id: "workspace" }, user: { id: "actor" } }) },
            "@/lib/teams/server": { assertNativeConversationAccess: async () => true, loadNativeMessageForCurrentUser: loadMessage },
            "@/lib/communications/server": { loadCommunicationMessage: loadMessage },
            "@/lib/communications/access": { clientConversationCanAccess: async () => true },
            "@/lib/supabase/admin": { supabaseAdmin: { from: () => query } },
            "@/lib/communications/checklists": { ...f.service, updateChatCheckbox: async (input: { loadBody: () => Promise<string> }) => {
                assert.equal(await input.loadBody(), body)
                return { body: savedBody }
            } },
        })
        const response = await route.PATCH(new Request("https://example.test/checklist", { method: "PATCH", body: JSON.stringify({ messageId: id, conversationId: id, relationshipId: id, expectedBody: body, line: 0, checked: true }) }), { params: Promise.resolve({ workspaceSlug: "test" }) })
        assert.equal(response.status, 200)
        const result = await response.json()
        assert.equal(result.body, savedBody)
        assert.equal(result.message.body, savedBody, "already-open clients retain their message response")
        assert.equal(result.message.status, "sent")
        assert.equal(reads, 1)
    }
})
