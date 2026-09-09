import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import ts from "typescript"
import * as formatting from "../lib/chat-formatting.ts"
import * as coordinated from "../lib/communications/coordinated-updates.ts"

const path = "lib/communications/checklist-updates.ts"
const compiled = new Module(resolve(path)) as Module & { _compile: (source: string, filename: string) => void }
const localRequire = createRequire(resolve(path))
compiled.require = ((name: string) => name === "@/lib/chat-formatting" ? formatting : name === "@/lib/communications/coordinated-updates" ? coordinated : localRequire(name)) as typeof compiled.require
compiled._compile(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, path)
const { createChecklistUpdates, requestChatCheckbox } = compiled.exports as typeof import("../lib/communications/checklist-updates")
const original = "[ ] First\n[ ] Second\n[ ] Third"
const changed = (body: string, line: number, checked: boolean) => formatting.chatCheckboxBody(body, line, checked)!
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function fixture() {
    const updates = createChecklistUpdates(original)
    let body = original
    const requests: { line: number; checked: boolean; expectedBody: string; complete: () => void; fail: (error: Error) => void }[] = []
    const save = (line: number, checked: boolean, expectedBody: string) => new Promise<string>((resolve, reject) => {
        requests.push({ line, checked, expectedBody, complete: () => { body = changed(body, line, checked); resolve(body) }, fail: reject })
    })
    return { updates, requests, save, body: () => body }
}

test("rapid clicks on different items appear immediately and all persist in order", async () => {
    const f = fixture()
    f.updates.toggle(0, f.save); f.updates.toggle(1, f.save); f.updates.toggle(2, f.save)
    assert.equal(f.updates.getSnapshot().body, "[x] First\n[x] Second\n[x] Third")
    await tick()
    assert.equal(f.requests.length, 1)
    for (let i = 0; i < 3; i++) { f.requests[i].complete(); await tick() }
    await f.updates.whenIdle()
    assert.equal(f.body(), f.updates.getSnapshot().body)
    assert.deepEqual(f.updates.getSnapshot().pending, [])
    assert.equal(f.requests[1].expectedBody, changed(original, 0, true))
})

test("changing a pending item back is preserved through the first acknowledgement", async () => {
    const f = fixture()
    f.updates.toggle(0, f.save); await tick()
    f.updates.toggle(0, f.save)
    assert.equal(f.updates.getSnapshot().body, original)
    f.requests[0].complete(); await tick()
    assert.equal(f.updates.getSnapshot().body, original)
    assert.equal(f.requests[1].checked, false)
    assert.equal(f.requests[1].expectedBody, changed(original, 0, true))
    f.requests[1].complete(); await f.updates.whenIdle()
    assert.equal(f.body(), original)
})

test("several reversals coalesce to the last requested state without redundant saves", async () => {
    const f = fixture()
    f.updates.toggle(0, f.save); await tick()
    f.updates.toggle(0, f.save); f.updates.toggle(0, f.save)
    f.requests[0].complete(); await f.updates.whenIdle()
    assert.equal(f.requests.length, 1)
    assert.equal(f.body(), changed(original, 0, true))
})

test("refreshes and parent optimistic echoes cannot erase queued items or become rollback state", async () => {
    const f = fixture()
    f.updates.toggle(0, f.save); f.updates.toggle(1, f.save); await tick()
    f.updates.receive(changed(original, 0, true)); f.updates.receive(original)
    f.requests[0].fail(new coordinated.ChatMutationError("Permission changed")); await tick()
    assert.equal(f.updates.getSnapshot().body, changed(original, 1, true))
    f.requests[1].complete(); await f.updates.whenIdle()
    assert.equal(f.body(), changed(original, 1, true))
    assert.equal(f.updates.getSnapshot().error, "Permission changed")
})

test("a lost acknowledgement retries its idempotent state once", async () => {
    const updates = createChecklistUpdates(original)
    let calls = 0, stored = original
    updates.toggle(0, async (line, checked) => {
        stored = changed(stored, line, checked)
        if (++calls === 1) throw new coordinated.ChatMutationError("Connection interrupted", true)
        return stored
    })
    await updates.whenIdle()
    assert.equal(calls, 2)
    assert.equal(updates.getSnapshot().body, stored)
    assert.equal(updates.getSnapshot().error, null)
})

test("uncertain saves have a finite retry budget and leave an actionable error", async () => {
    const updates = createChecklistUpdates(original)
    let calls = 0
    updates.toggle(0, async () => { calls++; throw new coordinated.ChatMutationError("Try again", true) })
    await updates.whenIdle()
    assert.equal(calls, 2)
    assert.equal(updates.getSnapshot().body, original)
    assert.equal(updates.getSnapshot().error, "Try again")
    updates.toggle(0, async () => changed(original, 0, true)); await updates.whenIdle()
    assert.equal(updates.getSnapshot().error, null)
})

test("an obsolete failed state is not retried over a newer click", async () => {
    const f = fixture()
    f.updates.toggle(0, f.save); await tick(); f.updates.toggle(0, f.save)
    f.requests[0].fail(new coordinated.ChatMutationError("Connection interrupted", true)); await tick()
    assert.equal(f.requests.length, 2)
    assert.equal(f.requests[1].checked, false)
    f.requests[1].complete(); await f.updates.whenIdle()
    assert.equal(f.body(), original)
})

test("changed wording cancels queued old line numbers and ignores the old response", async () => {
    const f = fixture()
    f.updates.toggle(0, f.save); f.updates.toggle(1, f.save); await tick()
    const edited = "[ ] Inserted\n" + original
    f.updates.receive(edited)
    f.requests[0].complete(); await f.updates.whenIdle()
    assert.equal(f.requests.length, 1)
    assert.equal(f.updates.getSnapshot().body, edited)
    assert.ok(f.updates.getSnapshot().error?.includes("edited"))
})

test("leaving the mounted message does not discard accepted queued clicks", async () => {
    const f = fixture(), unsubscribe = f.updates.subscribe(() => {})
    f.updates.toggle(0, f.save); f.updates.toggle(1, f.save); await tick(); unsubscribe()
    f.requests[0].complete(); await tick(); f.requests[1].complete(); await f.updates.whenIdle()
    assert.equal(f.body(), "[x] First\n[x] Second\n[ ] Third")
})

test("a hung checklist request times out as uncertain instead of blocking the queue forever", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new Error("Aborted")))
    }))
    const request = requestChatCheckbox("https://example.test/checklist", { messageId: "test", line: 0, checked: true, expectedBody: original })
    t.mock.timers.tick(15_000)
    await assert.rejects(request, (error: unknown) => error instanceof coordinated.ChatMutationError && error.uncertain)
})

test("checkbox requests accept both current and already-deployed acknowledgement formats", async (t) => {
    const saved = changed(original, 0, true)
    for (const payload of [{ body: saved }, { message: { body: saved } }]) {
        t.mock.method(globalThis, "fetch", async () => Response.json(payload))
        assert.equal(await requestChatCheckbox("https://example.test/checklist", { messageId: "test", line: 0, checked: true, expectedBody: original }), saved)
        t.mock.restoreAll()
    }
})
