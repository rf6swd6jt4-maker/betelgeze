import assert from "node:assert/strict"
import test from "node:test"
import { flushWorkspaceAutosaves, registerWorkspaceAutosaveFlusher } from "../lib/workspace-mutations.ts"

test("navigation waits for durable intent, refuses failed storage and never claims timed-out writes saved", async () => {
    const original = globalThis.window
    globalThis.window = { setTimeout, clearTimeout } as unknown as Window & typeof globalThis
    try {
        let flushed = 0
        let finish!: () => void
        const network = new Promise<void>((resolve) => { finish = resolve })
        const unregister = registerWorkspaceAutosaveFlusher(async () => { flushed++; await network }, { checkpoint: () => true })
        assert.equal(await flushWorkspaceAutosaves(10, { navigation: true }), true)
        assert.equal(flushed, 1)
        unregister(); finish()
        const deny = registerWorkspaceAutosaveFlusher(async () => false, { checkpoint: () => false })
        assert.equal(await flushWorkspaceAutosaves(10, { navigation: true }), false)
        deny()
        const timeout = registerWorkspaceAutosaveFlusher(() => new Promise(() => {}))
        assert.equal(await flushWorkspaceAutosaves(5, { navigation: true }), false)
        timeout()
        assert.equal(await flushWorkspaceAutosaves(5, { navigation: true }), true)
    } finally { globalThis.window = original }
})
