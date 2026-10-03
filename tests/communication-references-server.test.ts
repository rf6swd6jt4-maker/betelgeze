import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import ts from "typescript"
import * as formatting from "../lib/chat-formatting.ts"
import { readReferenceResults } from "../lib/communications/reference-results.ts"

function load(path: string, dependencies: Record<string, unknown>) {
    const compiled = new Module(resolve(path)) as Module & { _compile: (source: string, filename: string) => void }
    const localRequire = createRequire(resolve(path))
    compiled.require = ((name: string) => name === "server-only" ? {} : name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiled.require
    compiled._compile(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, path)
    return compiled.exports
}
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const reference = { type: "asset", id: id(5) } as const
const input = { workspaceSlug: "synthetic", workspaceId: id(1), userId: id(2), conversationId: id(3) }
function fixture() {
    const calls: Array<Record<string, unknown>> = []
    let data: unknown = { scope: { userId: input.userId, workspaceId: input.workspaceId }, relationshipRoute: "work", results: [{ ...reference, label: "Review PDF", detail: null }] }
    let error: unknown = null
    const service = load("lib/communications/references-server.ts", {
        "@/lib/communications/references": formatting,
        "@/lib/relationships": Object.fromEntries([["assetHref", "assets"], ["workItemHref", "work-items"], ["relationshipHubHref", "relationships"], ["onboardingDetailHref", "onboarding"], ["fulfilmentDetailHref", "work"]].map(([name, path]) => [name, (slug: string, recordId: string) => `/${slug}/${path}/${recordId}`])),
        "@/lib/supabase/admin": { supabaseAdmin: { rpc: (name: string, parameters: Record<string, unknown>) => {
            assert.equal(name, "read_communication_references"); calls.push(parameters)
            const result = Promise.resolve({ data, error }) as Promise<unknown> & { abortSignal: (signal: AbortSignal) => Promise<unknown> }
            result.abortSignal = () => result
            return result
        } } },
    }) as typeof import("../lib/communications/references-server")
    return { service, calls, setData(value: unknown) { data = value }, fail() { error = new Error("private database error") } }
}

test("reference batch parser enforces kinds, identities, bounded input and deduplication", () => {
    const { service } = fixture()
    assert.deepEqual(service.parseReferenceBatch([reference, reference]), [reference])
    for (const value of [null, {}, [null], [{ type: "person", id: id(5) }], [{ type: "asset", id: "invalid" }], Array.from({ length: 41 }, () => reference)]) assert.equal(service.parseReferenceBatch(value), null)
})

test("ordinary sends and edits retaining existing unavailable references perform no reference RPC", async () => {
    const { service, calls } = fixture()
    await service.validateCommunicationReferences({ ...input, body: "Plain message with @someone" })
    const source = formatting.chatRecordReferenceSource(reference)
    await service.validateCommunicationReferences({ ...input, body: `Changed words ${source}`, originalBody: `Original ${source}` })
    assert.equal(calls.length, 0)
})

test("new reference validation performs one deduplicated actor-bound batch and never trusts payload labels", async () => {
    const { service, calls } = fixture()
    const source = formatting.chatRecordReferenceSource(reference)
    await service.validateCommunicationReferences({ ...input, body: `${source} and ${source}` })
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], { p_workspace_slug: "synthetic", p_user_id: id(2), p_conversation_id: id(3), p_query: null, p_references: [reference] })
    const resolved = await service.readCommunicationReferences({ ...input, references: [reference] })
    assert.deepEqual(resolved.results, [{ ...reference, label: "Review PDF", href: `/synthetic/assets/${id(5)}` }])
})

test("new denied references, scope mismatch, unavailable conversation and database failures fail closed", async () => {
    const f = fixture()
    const source = formatting.chatRecordReferenceSource(reference)
    f.setData({ scope: { userId: input.userId, workspaceId: input.workspaceId }, relationshipRoute: "work", results: [] })
    await assert.rejects(f.service.validateCommunicationReferences({ ...input, body: source }), error => error instanceof f.service.CommunicationReferenceError && error.status === 403)
    for (const data of [null, { scope: { userId: id(99), workspaceId: input.workspaceId }, relationshipRoute: "work", results: [] }, { scope: { userId: input.userId, workspaceId: id(99) }, relationshipRoute: "work", results: [{ ...reference, label: "Secret" }] }]) {
        f.setData(data)
        await assert.rejects(f.service.validateCommunicationReferences({ ...input, body: source }))
    }
    f.fail()
    await assert.rejects(f.service.readCommunicationReferences({ ...input, references: [reference] }), /temporarily unavailable/)
})

test("edited text validates only added references and uses minimal server-derived destinations", async () => {
    const f = fixture()
    const prior = { type: "work_item", id: id(6) } as const
    await f.service.validateCommunicationReferences({ ...input, body: `${formatting.chatRecordReferenceSource(prior)} ${formatting.chatRecordReferenceSource(reference)}`, originalBody: formatting.chatRecordReferenceSource(prior) })
    assert.deepEqual(f.calls[0].p_references, [reference])
    for (const route of ["relationships", "onboarding", "work"]) {
        f.setData({ scope: { userId: input.userId, workspaceId: input.workspaceId }, relationshipRoute: route, results: [{ type: "relationship", id: id(7), label: "Acme", detail: "Business" }] })
        assert.equal((await f.service.readCommunicationReferences({ ...input, query: "ac" })).results[0].href, `/synthetic/${route}/${id(7)}`)
    }
})

test("reference endpoint authenticates before RPC, rejects bad inputs and never caches private labels", async () => {
    const f = fixture()
    let signedIn = true
    const route = load("app/api/workspaces/[workspaceSlug]/communications/native/references/route.ts", {
        "@/lib/auth/aal": { getAal2User: async () => signedIn ? { id: input.userId } : null },
        "@/lib/supabase/server": { createSupabaseServerClient: async () => ({}) },
        "@/lib/workspace-search-server": { withSearchDeadline: async (signal: AbortSignal, work: (signal: AbortSignal) => unknown) => work(signal) },
        "@/lib/communications/references-server": f.service,
    })
    const context = { params: Promise.resolve({ workspaceSlug: input.workspaceSlug }) }
    signedIn = false
    assert.equal((await route.GET(new Request(`https://example.test/api?conversationId=${id(3)}&q=ac`), context)).status, 401)
    assert.equal(f.calls.length, 0)
    signedIn = true
    assert.equal((await route.GET(new Request("https://example.test/api?conversationId=bad"), context)).status, 400)
    assert.equal((await route.POST(new Request("https://example.test/api", { method: "POST", body: JSON.stringify({ conversationId: id(3), references: [{ type: "asset", id: "bad" }] }) }), context)).status, 400)
    const response = await route.GET(new Request(`https://example.test/api?conversationId=${id(3)}&q=ac`), context)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Cache-Control"), "private, no-store")
    assert.equal(response.headers.get("Vary"), "Cookie")
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].p_user_id, input.userId)
})

test("native send recovers accepted request IDs before reference validation and rejects new denied references before insert", async () => {
    const source = readFileSync("app/api/workspaces/[workspaceSlug]/communications/native/messages/route.ts", "utf8")
    const ast = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === "handlePOST")
    assert.ok(node)
    const code = ts.transpileModule(node.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
    for (const [existing, allowed, status, rpcCount, writeCount] of [[true, false, 200, 0, 0], [false, false, 403, 1, 0], [false, true, 200, 1, 1]] as const) {
        const f = fixture()
        let writes = 0
        if (!allowed) f.setData({ scope: { userId: input.userId, workspaceId: input.workspaceId }, relationshipRoute: "work", results: [] })
        const body = formatting.chatRecordReferenceSource(reference)
        const query = {
            select: () => query, eq: () => query,
            maybeSingle: async () => ({ data: existing ? { id: id(8) } : null, error: null }),
            insert: () => { writes++; return query }, single: async () => ({ data: { id: id(8) }, error: null }),
        }
        const dependencies = {
            Response, UUID_PATTERN: f.service.REFERENCE_UUID_PATTERN, markChatBoundary: () => {},
            requireCommunicationsWorkspace: async () => ({ workspace: { id: input.workspaceId, slug: input.workspaceSlug }, user: { id: input.userId } }),
            nativeAttachmentFromInput: () => null, messageQuoteFromValue: () => null, assertNativeConversationAccess: async () => input.conversationId,
            supabaseAdmin: { from: () => query }, attachmentBatch: () => [], packAttachments: () => null,
            after: () => {}, notifyNativeChatMessage: async () => {}, loadNativeMessageForCurrentUser: async () => ({ id: id(8), conversationId: input.conversationId, body }),
            validateCommunicationReferences: f.service.validateCommunicationReferences, CommunicationReferenceError: f.service.CommunicationReferenceError,
        }
        const post = new Function(...Object.keys(dependencies), `${code};return handlePOST`)(...Object.values(dependencies))
        const response = await post(new Request("https://example.test/api", { method: "POST", body: JSON.stringify({ conversationId: input.conversationId, clientRequestId: id(9), body }) }), { params: Promise.resolve({ workspaceSlug: input.workspaceSlug }) }) as Response
        assert.equal(response.status, status)
        assert.equal(f.calls.length, rpcCount)
        assert.equal(writes, writeCount)
    }
})


test("authorised stored labels normalize to compact text without invalidating the picker", async () => {
    const f = fixture()
    for (const [label, detail, expectedLabel, expectedDetail] of [
        ["  Review\nPDF\tfile\u007f ", "  Acme\r\nBusiness\u0085 ", "Review PDF file", "Acme Business"],
        [" \t\n\u0001 ", "\n \t", "Untitled", undefined],
        ["😀".repeat(240), "😀".repeat(160), "😀".repeat(120), "😀".repeat(80)],
        ["a".repeat(239) + "😀", null, "a".repeat(239), undefined],
    ]) {
        f.setData({ scope: { userId: input.userId, workspaceId: input.workspaceId }, relationshipRoute: "work", results: [{ ...reference, label, detail }] })
        const response = await f.service.readCommunicationReferences({ ...input, query: "review" })
        const [result] = readReferenceResults(response, input, 4)
        assert.equal(result.label, expectedLabel)
        assert.equal(result.detail, expectedDetail)
        assert.ok(result.label.length <= 240)
        assert.ok((result.detail?.length ?? 0) <= 160)
    }
})
