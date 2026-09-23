import assert from "node:assert/strict"
import test from "node:test"
import { createWorkspaceShellStorage } from "../lib/workspace-shell-storage.ts"
import { flushWorkspaceAutosaves, registerWorkspaceAutosaveFlusher } from "../lib/workspace-mutations.ts"

for (const name of ["SecurityError", "QuotaExceededError"]) test(`optional shell metadata survives ${name} in memory and reports once`, () => {
    let reports = 0
    const fail = () => { throw new DOMException("Unavailable", name) }
    const storage = createWorkspaceShellStorage(() => ({ getItem: fail, setItem: fail, removeItem: fail }), () => reports++)
    assert.equal(storage.get("tabs"), null)
    storage.set("tabs", "restored state")
    storage.set("context", "false")
    assert.equal(storage.get("tabs"), "restored state")
    assert.equal(storage.get("context"), "false")
    storage.remove("context")
    assert.equal(storage.get("context"), null)
    assert.equal(reports, 1)
})

test("metadata removal affects only its exact key; successful storage works across shell lifetimes", () => {
    const values = new Map([["draft", "unsent"], ["context:closed", "false"]])
    const transport = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
    const first = createWorkspaceShellStorage(() => transport)
    first.set("tabs", "state")
    first.remove("context:closed")
    assert.equal(values.get("draft"), "unsent")
    assert.equal(createWorkspaceShellStorage(() => transport).get("tabs"), "state")
    assert.equal(first.get("context:closed"), null)
})

test("a failed removal stays removed in memory without keeping unbounded closed-key tombstones", () => {
    let reads = 0
    const storage = createWorkspaceShellStorage(() => ({ getItem: () => { reads++; return "old value" }, setItem() {}, removeItem() { throw new DOMException("Denied", "SecurityError") } }))
    storage.remove("context:closed")
    assert.equal(storage.get("context:closed"), null)
    assert.equal(reads, 0, "this shell lifetime uses memory only after persistent storage fails")
    storage.set("context:open", "current")
    assert.equal(storage.get("context:open"), "current")
})

test("optional shell storage failure never makes a failed draft checkpoint safe", async () => {
    const original = globalThis.window
    globalThis.window = { setTimeout, clearTimeout } as unknown as Window & typeof globalThis
    const unregister = registerWorkspaceAutosaveFlusher(async () => false, { checkpoint: () => { throw new Error("draft storage failed") } })
    try {
        const storage = createWorkspaceShellStorage(() => { throw new Error("metadata unavailable") })
        storage.set("tabs", "still usable")
        assert.equal(await flushWorkspaceAutosaves(10, { navigation: true }), false)
    } finally { unregister(); globalThis.window = original }
})
