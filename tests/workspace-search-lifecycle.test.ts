import assert from "node:assert/strict"
import test from "node:test"
import { createWorkspaceSearchController, workspaceSearchState, type WorkspaceSearchInput } from "../lib/workspace-search.ts"

const input: WorkspaceSearchInput = { scope: "user-a:workspace-a:staff", userId: "user-a", workspaceId: "workspace-a", workspaceSlug: "alpha", query: "first", open: true }
const result = (name: string) => ({ id: name, type: "Relationship", label: name, description: "Reference", href: `/alpha/relationships/${name}` })
const payload = (name: string, actor = "user-a") => ({ results: [result(name)], scope: { userId: actor, workspaceId: "workspace-a" } })
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 2))
function fixture(deadlineMs = 1000) {
    const requests: Array<{ signal: AbortSignal; reply: ReturnType<typeof deferred<Response>>; url: string }> = []
    const controller = createWorkspaceSearchController({ debounceMs: 0, deadlineMs, fetch: async (url, options) => {
        const reply = deferred<Response>()
        requests.push({ signal: options!.signal!, reply, url: String(url) })
        return reply.promise // Intentionally ignore abort to exercise stale handlers.
    } })
    return { controller, requests }
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

test("changed query clears and fences old results before the next request effect", async (t) => {
    const { controller, requests } = fixture(); t.after(() => controller.dispose())
    controller.update(input); await turn(); requests[0].reply.resolve(json(payload("first"))); await turn()
    assert.equal(controller.selected(input)?.id, "first")
    const next = { ...input, query: "second" }
    assert.equal(workspaceSearchState(controller.getSnapshot(), next).status, "loading")
    assert.equal(controller.selected(next), null)
    controller.update(next)
    assert.deepEqual(controller.getSnapshot().results, [])
    await turn(); requests[1].reply.resolve(json(payload("second"))); await turn()
    assert.equal(controller.selected(next)?.id, "second")
})

test("late response, rejected body and old finally cannot change newer results or their deadline", async (t) => {
    const { controller, requests } = fixture(30); t.after(() => controller.dispose())
    const body = deferred<unknown>()
    controller.update(input); await turn(); requests[0].reply.resolve({ ok: true, json: () => body.promise } as Response); await turn()
    const next = { ...input, query: "second" }; controller.update(next); await turn()
    assert.equal(requests[0].signal.aborted, true)
    body.reject(new Error("old parse failed")); await turn()
    assert.equal(controller.getSnapshot().status, "loading")
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert.equal(controller.getSnapshot().status, "error")
    assert.match(controller.getSnapshot().error!, /too long/)
    assert.equal(requests[1].signal.aborted, true)
    requests[1].reply.resolve(json(payload("late"))); await turn()
    assert.equal(controller.getSnapshot().status, "error")
})

test("A to B to A rejects the original A even when query text matches again", async (t) => {
    const { controller, requests } = fixture(); t.after(() => controller.dispose())
    controller.update(input); await turn()
    controller.update({ ...input, query: "second" }); await turn()
    controller.update(input); await turn()
    requests[0].reply.resolve(json(payload("old-a"))); requests[1].reply.reject(new Error("old-b")); await turn()
    assert.equal(controller.getSnapshot().status, "loading")
    requests[2].reply.resolve(json(payload("new-a"))); await turn()
    assert.equal(controller.selected(input)?.id, "new-a")
})

test("deadline covers a stalled JSON body and retry is a fresh manual request", async (t) => {
    const { controller, requests } = fixture(15); t.after(() => controller.dispose())
    const body = deferred<unknown>()
    controller.update(input); await turn(); requests[0].reply.resolve({ ok: true, json: () => body.promise } as Response)
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(controller.getSnapshot().status, "error")
    assert.equal(requests[0].signal.aborted, true)
    assert.equal(requests.length, 1)
    controller.retry(); await turn(); requests[1].reply.resolve(json(payload("retry"))); await turn()
    body.resolve(payload("late-body")); await turn()
    assert.equal(controller.selected(input)?.id, "retry")
})

test("close, short query and disposal cancel pending reads and reopen starts fresh", async (t) => {
    const { controller, requests } = fixture(); t.after(() => controller.dispose())
    controller.update(input); await turn()
    controller.update({ ...input, open: false })
    assert.equal(requests[0].signal.aborted, true)
    requests[0].reply.resolve(json(payload("closed"))); await turn()
    assert.equal(controller.getSnapshot().status, "idle")
    assert.deepEqual(controller.getSnapshot().results, [])
    controller.update(input); await turn(); assert.equal(requests.length, 2)
    controller.update({ ...input, query: "a" }); await turn()
    assert.equal(requests[1].signal.aborted, true); assert.equal(requests.length, 2)
    controller.update(input); await turn(); controller.dispose()
    assert.equal(requests[2].signal.aborted, true)
})

test("account, workspace and permission changes fence both rendering and selection", async (t) => {
    const { controller, requests } = fixture(); t.after(() => controller.dispose())
    controller.update(input); await turn(); requests[0].reply.resolve(json(payload("old"))); await turn()
    for (const next of [{ ...input, userId: "user-b" }, { ...input, workspaceId: "workspace-b" }, { ...input, workspaceSlug: "beta" }, { ...input, scope: "user-a:workspace-a:revoked" }]) {
        assert.deepEqual(workspaceSearchState(controller.getSnapshot(), next).results, [])
        assert.equal(controller.selected(next), null)
    }
    controller.invalidate(); assert.equal(controller.selected(input), null)
    controller.update({ ...input, open: false }); controller.update(input); controller.retry(); await turn()
    assert.equal(requests.length, 1)
    assert.match(controller.getSnapshot().error!, /session changed/)
    controller.update({ ...input, scope: "new-context" }); await turn(); assert.equal(requests.length, 2)
})

test("API actor mismatch and access denial clear results and prevent same-scope retries", async (t) => {
    for (const response of [json(payload("wrong-actor", "user-b")), json({}, 401), json({}, 403)]) {
        const { controller, requests } = fixture(); t.after(() => controller.dispose())
        controller.update(input); await turn(); requests[0].reply.resolve(response); await turn()
        assert.equal(controller.getSnapshot().status, "error"); assert.deepEqual(controller.getSnapshot().results, [])
        assert.match(controller.getSnapshot().error!, /session or access changed/)
        controller.retry(); await turn(); assert.equal(requests.length, 1)
    }
})

test("HTTP errors and malformed payload are visible, empty success stays distinct", async (t) => {
    for (const response of [json({}, 503), json({}, 504), json({}, 400), json({ scope: payload("").scope, results: [{ ...result("unsafe"), href: "//evil.example" }] }), json({ scope: payload("").scope, results: [result("same"), result("same")] }), new Response("invalid-json")]) {
        const { controller, requests } = fixture(); t.after(() => controller.dispose())
        controller.update(input); await turn(); requests[0].reply.resolve(response); await turn()
        assert.equal(controller.getSnapshot().status, "error"); assert.equal(controller.selected(input), null)
    }
    const { controller, requests } = fixture(); t.after(() => controller.dispose())
    controller.update(input); await turn(); requests[0].reply.resolve(json({ results: [], scope: payload("").scope })); await turn()
    assert.equal(controller.getSnapshot().status, "empty"); assert.equal(controller.getSnapshot().error, null)
})

test("selection wraps, respects Home/End and cannot choose a stale result ID", async (t) => {
    const { controller, requests } = fixture(); t.after(() => controller.dispose())
    controller.update(input); await turn(); requests[0].reply.resolve(json({ results: [result("one"), result("two"), result("three")], scope: payload("").scope })); await turn()
    controller.moveSelection("ArrowUp"); assert.equal(controller.selected(input)?.id, "three")
    controller.moveSelection("ArrowDown"); assert.equal(controller.selected(input)?.id, "one")
    controller.moveSelection("End"); assert.equal(controller.selected(input)?.id, "three")
    controller.moveSelection("Home"); assert.equal(controller.selected(input)?.id, "one")
    assert.equal(controller.selected(input, "missing"), null)
    assert.equal(controller.selected({ ...input, open: false }, "one"), null)
})

test("debounce admits only the latest query and no read for short/overlong queries", async (t) => {
    let requests = 0
    const controller = createWorkspaceSearchController({ debounceMs: 15, fetch: async () => { requests += 1; return json({ results: [], scope: payload("").scope }) } }); t.after(() => controller.dispose())
    controller.update(input); controller.update({ ...input, query: "second" }); controller.update({ ...input, query: "third" })
    await new Promise((resolve) => setTimeout(resolve, 25)); assert.equal(requests, 1)
    controller.update({ ...input, query: "x" }); controller.update({ ...input, query: "x".repeat(201) })
    await new Promise((resolve) => setTimeout(resolve, 25)); assert.equal(requests, 1)
    assert.equal(controller.getSnapshot().status, "error")
})


test("elapsed deadline rejects resumed fetch and JSON even when its timer has not fired", async (t) => {
    for (const phase of ["fetch", "json"]) {
        let now = 0
        const headers = deferred<Response>(), body = deferred<unknown>()
        const controller = createWorkspaceSearchController({ debounceMs: 0, deadlineMs: 1000, now: () => now, fetch: () => headers.promise }); t.after(() => controller.dispose())
        controller.update(input); await turn()
        if (phase === "json") { headers.resolve({ ok: true, json: () => body.promise } as Response); await turn() }
        now = 1001
        if (phase === "fetch") headers.resolve(json(payload("expired")))
        else body.resolve(payload("expired"))
        await turn()
        assert.equal(controller.getSnapshot().status, "error")
        assert.match(controller.getSnapshot().error!, /too long/)
        assert.equal(controller.selected(input), null)
    }
})
