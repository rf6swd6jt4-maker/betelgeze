import assert from "node:assert/strict"
import test from "node:test"
import { WorkspaceRecordCache } from "../lib/workspace-record-cache.ts"
import { nativeWorkspaceRoute, workspaceNativePanelsEnabled, workspacePerformanceEnabled } from "../lib/workspace-native.ts"

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
}

test("a hung shared read expires, releases retry, and cannot overwrite its replacement", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const cache = new WorkspaceRecordCache<string>()
    const hung = deferred<string>()
    let signal: AbortSignal | undefined
    let reads = 0
    const read = (value: AbortSignal) => { signal = value; reads++; return hung.promise }
    const first = cache.load("record", read)
    const duplicate = cache.load("record", read, { force: true })
    const rejected = Promise.all([assert.rejects(first, /too long/), assert.rejects(duplicate, /too long/)])
    await Promise.resolve()
    t.mock.timers.tick(29_999)
    assert.equal(cache.getSnapshot("record").loading, true)
    t.mock.timers.tick(1)
    await rejected
    assert.equal(reads, 1)
    assert.equal(signal?.aborted, true)
    assert.equal(cache.getSnapshot("record").loading, false)
    assert.match(cache.getSnapshot("record").error!, /retry/)
    await cache.load("record", async () => "replacement", { force: true })
    hung.resolve("too late")
    await Promise.resolve()
    assert.equal(cache.getSnapshot("record").data, "replacement")
})

test("timed-out background refresh keeps the usable cached panel", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const cache = new WorkspaceRecordCache<string>()
    cache.seed("record", "usable")
    const pending = cache.load("record", () => new Promise<string>(() => {}), { force: true })
    const rejected = assert.rejects(pending, /too long/)
    t.mock.timers.tick(30_000)
    await rejected
    assert.equal(cache.getSnapshot("record").data, "usable")
    assert.equal(cache.getSnapshot("record").loading, false)
})

test("expiration of an invalidated read cannot fail the newer generation", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const cache = new WorkspaceRecordCache<string>()
    const pending = cache.load("record", () => new Promise<string>(() => {}))
    const rejected = assert.rejects(pending, /too long/)
    cache.invalidate()
    await cache.load("record", async () => "new")
    t.mock.timers.tick(30_000)
    await rejected
    assert.equal(cache.getSnapshot("record").data, "new")
    assert.equal(cache.getSnapshot("record").error, null)
})

test("shared panel reads deduplicate in-flight requests and retain a stable cached snapshot", async () => {
    const cache = new WorkspaceRecordCache<number>()
    const gate = deferred<number>()
    let reads = 0
    const read = () => { reads++; return gate.promise }
    const first = cache.load("account:workspace:record", read)
    const second = cache.load("account:workspace:record", read)
    gate.resolve(42)
    assert.deepEqual(await Promise.all([first, second]), [42, 42])
    assert.equal(reads, 1)
    const snapshot = cache.getSnapshot("account:workspace:record")
    await cache.load("account:workspace:record", read)
    assert.equal(cache.getSnapshot("account:workspace:record"), snapshot)
    assert.equal(reads, 1)
})

test("invalidation fences an older response while a new read publishes", async () => {
    const cache = new WorkspaceRecordCache<string>()
    const old = deferred<string>()
    const first = cache.load("record", () => old.promise)
    await Promise.resolve()
    cache.invalidate()
    await cache.load("record", async () => "new", { force: true })
    old.resolve("old")
    await first
    assert.equal(cache.getSnapshot("record").data, "new")
})

test("account clear immediately removes visible data and fences late old-account results", async () => {
    const cache = new WorkspaceRecordCache<string>()
    const gate = deferred<string>()
    let notified = 0
    const unsubscribe = cache.subscribe("old", () => notified++)
    cache.seed("old", "private")
    const pending = cache.load("old", () => gate.promise, { force: true })
    await Promise.resolve()
    cache.clear()
    gate.resolve("late private")
    await pending
    assert.equal(cache.getSnapshot("old").data, null)
    assert.ok(notified >= 3)
    unsubscribe()
})

test("LRU preserves mounted data and accepts another subscribed panel beyond the soft limit", () => {
    const cache = new WorkspaceRecordCache<string>(1)
    const a = cache.subscribe("a", () => {})
    cache.seed("a", "one")
    const b = cache.subscribe("b", () => {})
    cache.seed("b", "two")
    assert.equal(cache.getSnapshot("a").data, "one")
    assert.equal(cache.getSnapshot("b").data, "two")
    a(); b()
})

test("failed refresh preserves available content with an explicit error", async () => {
    const cache = new WorkspaceRecordCache<string>()
    cache.seed("a", "available")
    await assert.rejects(cache.load("a", async () => { throw new Error("network unavailable") }, { force: true }))
    assert.equal(cache.getSnapshot("a").data, "available")
    assert.equal(cache.getSnapshot("a").error, "network unavailable")
    assert.equal(cache.getSnapshot("a").loading, false)
})

test("native routing separates workspace identity and reuses local filter data", () => {
    const id = "30000000-0000-4000-8000-000000000001"
    assert.equal(nativeWorkspaceRoute("/other/relationships", "fixture-workspace"), null)
    assert.equal(nativeWorkspaceRoute("/fixture-workspace/relationships?phase=lead", "fixture-workspace")?.key, "/fixture-workspace/relationships")
    assert.equal(nativeWorkspaceRoute(`/fixture-workspace/work-items/${id}`, "fixture-workspace")?.relationshipId, id)
    assert.equal(nativeWorkspaceRoute("/fixture-workspace/relationships/not-a-record", "fixture-workspace"), null)
    assert.equal(workspaceNativePanelsEnabled("one", undefined), false)
    assert.equal(workspaceNativePanelsEnabled("one", "two, one"), true)
})

test("a late save invalidates a cold read with an observable one-shot reload revision", async () => {
    const cache = new WorkspaceRecordCache<string>()
    const firstRead = deferred<string>()
    const pending = cache.load("new-panel", () => firstRead.promise)
    await Promise.resolve()
    const revision = cache.getSnapshot("new-panel").revision
    cache.invalidate()
    assert.equal(cache.getSnapshot("new-panel").revision, revision + 1)
    assert.equal(cache.getSnapshot("new-panel").loading, false)
    await cache.load("new-panel", async () => "fresh panel")
    assert.equal(cache.getSnapshot("new-panel").revision, revision + 1, "settling the replacement must not trigger another reload")
    firstRead.resolve("stale before save")
    await pending
    assert.equal(cache.getSnapshot("new-panel").data, "fresh panel")
})

test("React-style subscribed snapshot reads cannot repeat live Map invalidation indefinitely", () => {
    const cache = new WorkspaceRecordCache<string>()
    cache.seed("a", "first")
    cache.seed("b", "second")
    const visits = { a: 0, b: 0 }
    for (const key of ["a", "b"] as const) cache.subscribe(key, () => {
        visits[key] += 1
        assert.ok(visits[key] <= 2, "each invalidation should notify an entry exactly once")
        cache.getSnapshot(key) // touches Map order just like useSyncExternalStore
    })
    cache.invalidate()
    assert.deepEqual(visits, { a: 1, b: 1 })
    cache.clear()
    assert.deepEqual(visits, { a: 2, b: 2 })
    assert.equal(cache.getSnapshot("a").data, null)
    assert.equal(cache.getSnapshot("b").data, null)
})


test("performance rollout can be limited to an authorized operator without widening workspace selection", () => {
    assert.equal(workspacePerformanceEnabled("workspace", "operator", undefined, "operator"), false)
    assert.equal(workspacePerformanceEnabled("workspace", "operator", "workspace", "operator"), true)
    assert.equal(workspacePerformanceEnabled("workspace", "staff", "workspace", "operator"), false)
    assert.equal(workspacePerformanceEnabled("workspace", undefined, "workspace", "operator"), false)
    assert.equal(workspacePerformanceEnabled("workspace", "operator", "another", "operator"), false)
    assert.equal(workspacePerformanceEnabled("workspace", "staff", "workspace", undefined), true)
})
