import assert from "node:assert/strict"
import test from "node:test"
import { CommunicationsHostAccessError, communicationsLocation, readNativeCommunications } from "../lib/communications/native-host.ts"

const scope = { workspaceId: "workspace-a", workspaceSlug: "example", userId: "user-a" }
const bootstrap = { workspaceId: scope.workspaceId, workspaceSlug: scope.workspaceSlug, currentUser: { id: scope.userId }, conversations: [] }
const read = (url: string, signal = new AbortController().signal) => readNativeCommunications({ ...scope, url, signal })

test("Communications locations retain separate client, Team and DM intent", () => {
    assert.deepEqual(communicationsLocation("/example/communications?conversation=client-a", "example"), { mode: "clients", conversationId: "client-a", nativeConversationId: undefined, dmUserId: undefined })
    assert.equal(communicationsLocation("/example/communications?dm=user-b", "example")?.mode, "team")
    assert.equal(communicationsLocation("/example/communications?mode=clients&nativeConversation=team-a", "example")?.mode, "clients")
    assert.equal(communicationsLocation("/other/communications", "example"), null)
    assert.equal(communicationsLocation("/example/communications/history", "example"), null)
})

test("native mobile entry requests only its active authorized mode", async t => {
    const calls: string[] = []
    t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
        calls.push(url)
        assert.equal(options.cache, "no-store")
        assert.equal(options.credentials, "same-origin")
        assert.ok(options.signal)
        return Response.json(bootstrap)
    })
    const client = await read("/example/communications?mode=clients&conversation=client-a&nativeConversation=team-a")
    assert.deepEqual(calls, ["/api/workspaces/example/communications/sync?conversation=client-a"])
    assert.deepEqual(client.clientBootstrap, bootstrap)
    assert.equal(client.nativeBootstrap, null)
    calls.length = 0
    const team = await read("/example/communications?mode=team&nativeConversation=team-a&dm=user-b")
    assert.deepEqual(calls, ["/api/workspaces/example/communications/native/conversations?conversation=team-a&dm=user-b"])
    assert.equal(team.clientBootstrap, null)
    assert.deepEqual(team.nativeBootstrap, bootstrap)
})

test("a changed account or workspace cannot populate a resident chat", async t => {
    for (const invalid of [{ ...bootstrap, currentUser: { id: "other-user" } }, { ...bootstrap, workspaceId: "other-workspace" }, { ...bootstrap, workspaceSlug: "other-slug" }]) {
        t.mock.method(globalThis, "fetch", async () => Response.json(invalid))
        await assert.rejects(read("/example/communications"), CommunicationsHostAccessError)
        t.mock.restoreAll()
    }
})

test("access loss differs from a retryable read failure", async t => {
    for (const status of [401, 403, 404, 409]) {
        t.mock.method(globalThis, "fetch", async () => new Response(null, { status }))
        await assert.rejects(read("/example/communications"), CommunicationsHostAccessError)
        t.mock.restoreAll()
    }
    t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }))
    await assert.rejects(read("/example/communications"), error => error instanceof Error && !(error instanceof CommunicationsHostAccessError))
})

test("aborting during response parsing prevents an obsolete bootstrap commit", async t => {
    const controller = new AbortController()
    t.mock.method(globalThis, "fetch", async () => ({
        ok: true, redirected: false, status: 200, headers: new Headers({ "content-type": "application/json" }),
        json: async () => { controller.abort(); return bootstrap },
    } as Response))
    await assert.rejects(read("/example/communications", controller.signal), error => error instanceof Error && error.name === "AbortError")
})

test("HTML login responses and malformed payloads never become chat content", async t => {
    t.mock.method(globalThis, "fetch", async () => new Response("login", { headers: { "content-type": "text/html" } }))
    await assert.rejects(read("/example/communications"), /Could not load conversations/)
    t.mock.restoreAll()
    t.mock.method(globalThis, "fetch", async () => Response.json({ ...bootstrap, conversations: null }))
    await assert.rejects(read("/example/communications"), CommunicationsHostAccessError)
})
