import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { createCommunicationsSyncOwner } from "../lib/communications/sync-owner.ts"

const settle = async () => { for (let turn = 0; turn < 30; turn++) await Promise.resolve() }

function deferredBody() {
    let finish!: () => void
    const response = new Response(new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('{"value":'))
            finish = () => { controller.enqueue(new TextEncoder().encode('1}')); controller.close() }
        },
    }))
    return { response, finish }
}

test("a hanging response body expires, releases the recovery slot and cannot apply late data", async () => {
    const body = deferredBody()
    const accepted: number[] = []
    let attempts = 0, firstSignal: AbortSignal | undefined
    const owner = createCommunicationsSyncOwner(async signal => {
        const response = ++attempts === 1 ? body.response : Response.json({ value: 2 })
        firstSignal ??= signal
        const data = await response.json()
        signal.throwIfAborted()
        accepted.push(data.value)
    }, 15)
    const first = owner.run()
    assert.equal(owner.run(), first, "overlapping recovery signals share the same operation")
    await assert.rejects(first, { name: "TimeoutError" })
    assert.equal(firstSignal?.aborted, true)
    assert.deepEqual(accepted, [])
    await owner.run()
    assert.equal(attempts, 2)
    assert.deepEqual(accepted, [2])
    body.finish()
    await settle()
    assert.deepEqual(accepted, [2], "late body completion must not restore a stale snapshot")
    owner.dispose()
})

test("account departure cancels the old owner while a new owner can recover independently", async () => {
    const body = deferredBody()
    const accepted: string[] = []
    let oldSignal: AbortSignal | undefined
    const oldOwner = createCommunicationsSyncOwner(async signal => {
        oldSignal = signal
        await body.response.json()
        signal.throwIfAborted()
        accepted.push("old-account")
    })
    const pending = oldOwner.run()
    const cancelled = assert.rejects(pending, { name: "AbortError" })
    await settle()
    oldOwner.dispose()
    await cancelled
    assert.equal(oldSignal?.aborted, true)
    await assert.rejects(oldOwner.run(), { name: "AbortError" })
    const newOwner = createCommunicationsSyncOwner(async signal => {
        signal.throwIfAborted()
        accepted.push("new-account")
    })
    await newOwner.run()
    body.finish()
    await settle()
    assert.deepEqual(accepted, ["new-account"])
    newOwner.dispose()
})

test("failed recovery releases its slot without starting an automatic retry loop", async () => {
    let attempts = 0
    const owner = createCommunicationsSyncOwner(async () => {
        if (++attempts === 1) throw new Error("offline")
    })
    await assert.rejects(owner.run(), /offline/)
    await settle()
    assert.equal(attempts, 1)
    await owner.run()
    assert.equal(attempts, 2)
    owner.dispose()
})

test("disposal before queued work starts prevents the departed owner from making a request", async () => {
    let attempts = 0
    const owner = createCommunicationsSyncOwner(async () => { attempts++ })
    const pending = owner.run()
    owner.dispose()
    await assert.rejects(pending, { name: "AbortError" })
    assert.equal(attempts, 0)
})

function mountRecovery(synchronize: (signal: AbortSignal) => Promise<void>, autoSubscribe = true) {
    const effects: Array<() => void | (() => void)> = []
    const intervals: Array<() => void> = []
    const timers = new Map<number, () => void>()
    const statuses: string[] = []
    const subscriptions: Array<(status: string) => void> = []
    let nextTimer = 0, authReads = 0, removals = 0
    let token = "fixture"
    let authChange: (event: string, session: { access_token: string }) => void = () => {}
    const appliedTokens: string[] = []
    const react = {
        useEffect: (effect: () => void | (() => void)) => effects.push(effect),
        useRef: (current: unknown) => ({ current }),
        useState: (value: unknown) => [typeof value === "function" ? value() : value, (next: string) => statuses.push(next)],
        useCallback: (callback: unknown) => callback,
    }
    const window = Object.assign(new EventTarget(), {
        setInterval: (callback: () => void) => { intervals.push(callback); return intervals.length }, clearInterval() {},
        setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer },
        clearTimeout: (id: number) => { timers.delete(id) },
    })
    const document = Object.assign(new EventTarget(), { visibilityState: "visible" })
    const code = ts.transpileModule(readFileSync("components/communications/useReliableCommunicationsRealtime.ts", "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText
    const hookExports: { useReliableCommunicationsRealtime?: (input: unknown) => void } = {}
    const require = (name: string) => {
        if (name === "react") return react
        if (name.endsWith("/sync-owner")) return { createCommunicationsSyncOwner }
        if (name.endsWith("/useWorkspaceTabActive")) return { useWorkspaceTabActive: () => true, WORKSPACE_TAB_VISIBILITY_EVENT: "workspace-visible" }
        throw new Error(`Unexpected fixture dependency: ${name}`)
    }
    new Function("require", "exports", "window", "document", "navigator", code)(require, hookExports, window, document, { onLine: true })
    const supabase = {
        auth: {
            getSession: async () => { authReads++; return { data: { session: { access_token: token } } } },
            onAuthStateChange: (callback: typeof authChange) => { authChange = callback; return { data: { subscription: { unsubscribe() {} } } } },
        },
        realtime: { setAuth: async (value: string) => { appliedTokens.push(value) } },
        removeChannel: async () => { removals++ },
        channel: () => ({ subscribe(callback: (status: string) => void) { subscriptions.push(callback); if (autoSubscribe) callback("SUBSCRIBED") } }),
    }
    hookExports.useReliableCommunicationsRealtime!({ active: true, privateChannel: false, register: (channel: unknown) => channel, schemaReady: true, supabase, synchronize, topic: "fixture-workspace", userId: "fixture-user" })
    const cleanups = effects.map(effect => effect()).filter((cleanup): cleanup is () => void => typeof cleanup === "function")
    return { window, document, intervals, timers, subscriptions, statuses, appliedTokens, removals: () => removals, auth: (value = token) => { token = value; authChange("SIGNED_IN", { access_token: token }) }, fireTimers: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()) }, authReads: () => authReads, dispose: () => cleanups.forEach(cleanup => cleanup()) }
}

test("safety ticks, focus and reconnect preflight share one request and retain the post-subscribe reconciliation", async () => {
    let attempts = 0, finish!: () => void
    const held = new Promise<void>(resolve => { finish = resolve })
    const app = mountRecovery(async signal => { if (++attempts === 2) await held; signal.throwIfAborted() })
    try {
        await settle()
        assert.equal(attempts, 1)
        app.intervals[0]()
        await settle()
        for (let index = 0; index < 4; index++) { app.intervals[0](); app.window.dispatchEvent(new Event("focus")) }
        await settle()
        assert.equal(attempts, 2)
        app.subscriptions[0]("CHANNEL_ERROR")
        const reconnect = [...app.timers.values()][0]
        assert.ok(reconnect)
        reconnect()
        await settle()
        assert.equal(attempts, 2, "reconnect must reuse the pending recovery, not bypass its owner")
        finish()
        await settle()
        assert.equal(app.subscriptions.length, 2)
        assert.equal(attempts, 3, "new subscription still reconciles the preflight-to-subscribe gap")
        assert.equal(app.statuses.at(-2), "live")
        app.document.visibilityState = "hidden"
        app.intervals[0]()
        app.window.dispatchEvent(new Event("focus"))
        await settle()
        assert.equal(attempts, 3, "hidden documents do not add safety reads")
    } finally { app.dispose() }
})

test("a disposed recovery hook cannot refresh auth or publish live state after a late response", async () => {
    let finish!: () => void
    const held = new Promise<void>(resolve => { finish = resolve })
    let signal: AbortSignal | undefined
    const app = mountRecovery(async current => { signal = current; await held; current.throwIfAborted() })
    await settle()
    assert.ok(signal)
    app.dispose()
    const before = { authReads: app.authReads(), states: app.statuses.length }
    finish()
    await settle()
    assert.equal(signal.aborted, true)
    assert.equal(app.authReads(), before.authReads)
    assert.equal(app.statuses.length, before.states)
})


test("focus, safety ticks and initial auth do not restart a pending channel join", async () => {
    let syncs = 0
    const app = mountRecovery(async () => { syncs++ }, false)
    try {
        await settle()
        app.auth(); app.fireTimers()
        app.window.dispatchEvent(new Event("focus")); app.intervals[0]()
        await settle()
        assert.equal(app.subscriptions.length, 1)
        assert.equal(app.removals(), 0)
        assert.equal(syncs, 0)
        app.subscriptions[0]("SUBSCRIBED"); await settle()
        assert.equal(syncs, 1)
        assert.equal(app.statuses.at(-2), "live")
    } finally { app.dispose() }
})

test("foreground recovery retains the joined channel while its initial reconciliation is pending", async () => {
    let finish!: () => void, syncs = 0
    const held = new Promise<void>(resolve => { finish = resolve })
    const app = mountRecovery(async () => { syncs++; await held })
    try {
        await settle()
        app.window.dispatchEvent(new Event("focus")); app.intervals[0]()
        await settle()
        assert.equal(app.removals(), 0)
        assert.equal(app.subscriptions.length, 1)
        finish(); await settle()
        assert.equal(syncs, 1)
        assert.equal(app.statuses.at(-2), "live")
    } finally { finish(); app.dispose() }
})

test("duplicate auth retains a live channel and changed tokens update auth without replaying bootstrap", async () => {
    let syncs = 0
    const app = mountRecovery(async () => { syncs++ })
    try {
        await settle()
        const reads = app.authReads(), writes = app.appliedTokens.length
        app.auth(); app.fireTimers(); await settle()
        assert.equal(app.authReads(), reads)
        assert.equal(app.appliedTokens.length, writes)
        app.auth("renewed"); app.fireTimers(); await settle()
        assert.equal(app.appliedTokens.at(-1), "renewed")
        assert.equal(app.removals(), 0)
        assert.equal(app.subscriptions.length, 1)
        assert.equal(syncs, 1)
        app.subscriptions[0]("CHANNEL_ERROR"); app.fireTimers(); await settle()
        assert.equal(app.subscriptions.length, 2)
        assert.equal(syncs, 3, "real reconnect retains preflight and post-subscribe recovery")
    } finally { app.dispose() }
})

test("SDK recovery cancels a scheduled chat restart without losing reconciliation", async () => {
    let syncs = 0
    const app = mountRecovery(async () => { syncs++ })
    try {
        await settle()
        app.subscriptions[0]("CHANNEL_ERROR")
        app.subscriptions[0]("SUBSCRIBED"); await settle()
        app.fireTimers(); await settle()
        assert.equal(app.subscriptions.length, 1)
        assert.equal(app.removals(), 0)
        assert.equal(syncs, 2)
    } finally { app.dispose() }
})
