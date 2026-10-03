import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import test from "node:test"
import type { RecordReference, ReferenceContext } from "../lib/chat-formatting.ts"

// Execute the production resolver with Node's TS transformer, resolving the
// application's two aliases without maintaining a second implementation.
const source = (await readFile(new URL("../lib/communications/reference-resolver.ts", import.meta.url), "utf8"))
    .replace('"@/lib/workspace-record-cache"', JSON.stringify(new URL("../lib/workspace-record-cache.ts", import.meta.url).href))
    .replace('"@/lib/communications/references"', JSON.stringify(new URL("../lib/chat-formatting.ts", import.meta.url).href))
    .replace('"@/lib/communications/reference-results"', JSON.stringify(new URL("../lib/communications/reference-results.ts", import.meta.url).href))
const { MessageReferenceResolver } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source, { mode: "transform" })).toString("base64")}`)
const context: ReferenceContext = { userId: "user-a", workspaceId: "workspace-a", workspaceSlug: "demo", conversationId: "chat-a" }
const reference = (number: number): RecordReference => ({ type: "asset", id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}` })
const key = (number: number) => `asset:${reference(number).id}`
const payload = (number: number, userId = context.userId) => ({ scope: { userId, workspaceId: context.workspaceId }, results: [{ ...reference(number), label: `Asset ${number}`, href: `/demo/assets/${reference(number).id}` }] })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
async function drain() { for (let index = 0; index < 30; index++) await Promise.resolve() }
function fixture() {
    const requests: { signal: AbortSignal; body: { references: RecordReference[] }; reply: ReturnType<typeof deferred<Response>> }[] = []
    const resolver = new MessageReferenceResolver(context, async (_url: string, options: RequestInit) => {
        const reply = deferred<Response>()
        requests.push({ signal: options.signal as AbortSignal, body: JSON.parse(String(options.body)), reply })
        return reply.promise // Ignore cancellation deliberately, as a stalled transport can.
    })
    return { resolver, requests }
}

test("reference resolution stays inactive until requested and batches repeated identities with a forty-record bound", async t => {
    const { resolver, requests } = fixture(); t.after(() => resolver.setActive(false))
    resolver.resolve(reference(1)); await drain(); assert.equal(requests.length, 0)
    resolver.setActive(true)
    for (let index = 1; index <= 41; index++) { resolver.resolve(reference(index)); resolver.resolve(reference(index)) }
    await drain()
    assert.equal(requests.length, 1)
    assert.equal(requests[0].body.references.length, 40)
    requests[0].reply.resolve(Response.json(payload(1))); await drain()
    assert.equal(requests.length, 2)
    assert.equal(requests[1].body.references.length, 1)
    assert.equal(resolver.cache.getSnapshot(key(1)).data.reference.label, "Asset 1")
    assert.equal(resolver.cache.getSnapshot(key(2)).data.reference, null)
})

test("a hung transport expires, releases the batch slot, and cannot overwrite an explicit retry", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const { resolver, requests } = fixture(); t.after(() => resolver.setActive(false))
    resolver.setActive(true); resolver.resolve(reference(1)); await drain()
    t.mock.timers.tick(8_000); await drain()
    assert.equal(requests[0].signal.aborted, true)
    assert.match(resolver.cache.getSnapshot(key(1)).error, /too long/)
    assert.equal(resolver.cache.getSnapshot(key(1)).loading, false)
    resolver.clear(); resolver.resolve(reference(1)); await drain()
    assert.equal(requests.length, 2)
    requests[1].reply.resolve(Response.json(payload(1))); await drain()
    requests[0].reply.resolve(Response.json(payload(2))); await drain()
    assert.equal(resolver.cache.getSnapshot(key(1)).data.reference.label, "Asset 1")
})

test("the same deadline covers a stalled response body and does not leave later batches queued", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const { resolver, requests } = fixture(); t.after(() => resolver.setActive(false))
    const body = deferred<unknown>()
    resolver.setActive(true); resolver.resolve(reference(1)); await drain()
    requests[0].reply.resolve({ ok: true, json: () => body.promise } as Response); await drain()
    t.mock.timers.tick(8_000); await drain()
    assert.match(resolver.cache.getSnapshot(key(1)).error, /too long/)
    resolver.resolve(reference(2)); await drain(); assert.equal(requests.length, 2)
    requests[1].reply.resolve(Response.json(payload(2))); await drain()
    body.resolve(payload(1)); await drain()
    assert.equal(resolver.cache.getSnapshot(key(1)).data, null)
    assert.equal(resolver.cache.getSnapshot(key(2)).data.reference.label, "Asset 2")
})

test("deactivation cancels a stalled lookup and reactivation starts immediately with fresh labels", async t => {
    const { resolver, requests } = fixture(); t.after(() => resolver.setActive(false))
    resolver.setActive(true); resolver.resolve(reference(1)); await drain()
    resolver.setActive(false)
    assert.equal(requests[0].signal.aborted, true)
    assert.equal(resolver.cache.getSnapshot(key(1)).data, null)
    resolver.setActive(true); resolver.resolve(reference(1)); await drain()
    assert.equal(requests.length, 2)
    requests[0].reply.resolve(Response.json(payload(1))); await drain()
    assert.equal(resolver.cache.getSnapshot(key(1)).data, null)
    requests[1].reply.resolve(Response.json(payload(1))); await drain()
    assert.equal(resolver.cache.getSnapshot(key(1)).data.reference.label, "Asset 1")
})

test("another account's payload never becomes a label and a selected authorised result can replace a denied snapshot", async t => {
    const { resolver, requests } = fixture(); t.after(() => resolver.setActive(false))
    resolver.setActive(true); resolver.resolve(reference(1)); await drain()
    requests[0].reply.resolve(Response.json(payload(1, "user-b"))); await drain()
    assert.equal(resolver.cache.getSnapshot(key(1)).data, null)
    assert.match(resolver.cache.getSnapshot(key(1)).error, /Could not check/)
    resolver.clear(); resolver.resolve(reference(1)); await drain()
    requests[1].reply.resolve(Response.json({ scope: payload(1).scope, results: [] })); await drain()
    assert.equal(resolver.cache.getSnapshot(key(1)).data.reference, null)
    resolver.remember(payload(1).results[0]); await drain()
    assert.equal(resolver.cache.getSnapshot(key(1)).data.reference.label, "Asset 1")
})
