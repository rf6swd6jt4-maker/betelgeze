import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { matchingConversationPreviewIds } from "../lib/communications/preview-search.ts"

const id = "00000000-0000-4000-8000-000000000001"
const deviceId = "00000000-0000-4000-8000-000000000002"
const body = "Greek ΑΒΓ and İstanbul and ẞ plus % literal"

test("preview search preserves JavaScript Unicode folding and literal substring semantics", () => {
    for (const query of ["αβγ", "i\u0307stanbul", "ß", "%", " ΑΒΓ "]) assert.deepEqual(matchingConversationPreviewIds([{ conversationId: id, body }], query), [id])
    for (const query of ["istanbul", "SS", "", "  ", "missing"]) assert.deepEqual(matchingConversationPreviewIds([{ conversationId: id, body }], query), [])
})

function fixture(payload: unknown = { deviceId, candidates: [{ conversationId: id, body }], nextCursor: null }) {
    const calls: unknown[] = []
    const source = ts.transpileModule(readFileSync("app/api/workspaces/[workspaceSlug]/communications/search/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const dependencies: Record<string, unknown> = {
        "@/lib/communications/preview-search": { matchingConversationPreviewIds },
        "@/lib/communications/device-server": { communicationDeviceId: async () => deviceId, validateCommunicationReadProtocol: () => "device-v1", deviceReadError: () => Response.json({ error: "unavailable" }, { status: 503 }) },
        "@/lib/communications/performance-server": { withChatPerformance: (_name: string, handler: unknown) => handler },
        "@/lib/communications/workspace-access": { requireCommunicationsWorkspace: async () => ({ workspace: { id }, user: { id } }) },
        "@/lib/push/device": { UUID_PATTERN: /^[0-9a-f-]{36}$/i },
        "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: payload, error: null } } }) },
    }
    const exports: Record<string, (request: Request, context: unknown) => Promise<Response>> = {}
    new Function("require", "exports", source)((name: string) => { assert.ok(name in dependencies, name); return dependencies[name] }, exports)
    return { calls, get: (search: string, kind = "client") => exports.GET(new Request(`https://fixture.test/api?readProtocol=device-v1&kind=${kind}&search=${encodeURIComponent(search)}`), { params: Promise.resolve({ workspaceSlug: "fixture" }) }) }
}

for (const kind of ["client", "native"]) test(`${kind} search route matches Unicode on the server and returns IDs without body candidates`, async () => {
    const state = fixture()
    const response = await state.get("αβγ", kind)
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.deepEqual(result, { readProtocol: "device-v1", deviceId, conversationIds: [id], nextCursor: null })
    assert.ok(!JSON.stringify(result).includes(body))
    assert.ok(!("candidates" in result))
    assert.equal(state.calls.length, 1)
})

test("search route rejects malformed or oversized server pages without leaking bodies", async () => {
    for (const payload of [{ deviceId, conversationIds: [id], nextCursor: null }, { deviceId, candidates: Array(21).fill({ conversationId: id, body }), nextCursor: null }, { deviceId, candidates: [{ conversationId: id }], nextCursor: null }]) {
        const response = await fixture(payload).get("αβγ")
        assert.equal(response.status, 503)
        assert.ok(!JSON.stringify(await response.json()).includes(body))
    }
})
