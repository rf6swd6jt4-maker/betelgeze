import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { confirmWorkspaceFrameDeparture, prepareWorkspaceFrameDeparture, workspaceResidentEvictions, WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE, WORKSPACE_FRAME_PAGE_ATTRIBUTE, WORKSPACE_FRAME_ERROR_ATTRIBUTE } from "../lib/workspace-tab-departure.ts"
import { checkpointWorkspaceAutosaves, registerWorkspaceAutosaveFlusher } from "../lib/workspace-mutations.ts"

function transport() {
    const listeners = new Set<(event: MessageEvent) => void>()
    const timers = new Map<number, () => void>()
    let next = 0
    const attributes = new Map([[WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE, "document-1"]])
    const document = { URL: "https://fixture.test/work", documentElement: { getAttribute: (key: string) => attributes.get(key) ?? null, hasAttribute: (key: string) => attributes.has(key) } }
    const sent: Array<Record<string, unknown>> = []
    let finalSafe = true
    const source = { postMessage: (message: Record<string, unknown>) => { sent.push(message) }, dispatchEvent: (event: CustomEvent) => { event.detail.safe = finalSafe; return true } }
    const frame = { contentDocument: document, contentWindow: source }
    const host = {
        location: { origin: "https://fixture.test" }, crypto: { randomUUID: () => `request-${++next}` },
        setTimeout: (callback: () => void) => { const id = ++next; timers.set(id, callback); return id },
        clearTimeout: (id: number) => { timers.delete(id) },
        addEventListener: (_type: string, callback: (event: MessageEvent) => void) => { listeners.add(callback) },
        removeEventListener: (_type: string, callback: (event: MessageEvent) => void) => { listeners.delete(callback) },
    }
    return {
        frame, host, attributes, sent, listeners, timers,
        finalSafe: (safe: boolean) => { finalSafe = safe },
        run: (signal?: AbortSignal, checkpointOnly = false) => prepareWorkspaceFrameDeparture(frame as unknown as HTMLIFrameElement, "tab", host as unknown as Window, signal, checkpointOnly),
        reply(overrides: Record<string, unknown> = {}, eventOverrides: Record<string, unknown> = {}) {
            const message = sent.at(-1)!
            for (const listener of [...listeners]) listener({ origin: host.location.origin, source, data: { ...message, target: "host", type: "departure-ready", safe: true, ...overrides }, ...eventOverrides } as unknown as MessageEvent)
        },
        expire() { for (const timer of [...timers.values()]) timer() },
    }
}

test("departure accepts only the exact request, frame, document, tab and origin", async () => {
    const f = transport()
    const pending = f.run()
    let settled = false
    void pending.then(() => { settled = true })
    for (const change of [{ requestId: "old" }, { documentId: "other" }, { tabId: "other" }, { target: "frame" }, { source: "foreign" }]) f.reply(change)
    f.reply({}, { source: {} }); f.reply({}, { origin: "https://other.test" })
    await Promise.resolve()
    assert.equal(settled, false)
    f.reply()
    assert.equal(await pending, true)
    assert.equal(f.listeners.size, 0); assert.equal(f.timers.size, 0)
})

test("an unchanged WindowProxy cannot authorize a replacement document", async () => {
    const f = transport()
    const pending = f.run()
    f.frame.contentDocument = { ...f.frame.contentDocument }
    f.reply()
    assert.equal(await pending, false)
})

test("a queued acknowledgement is followed by a synchronous final check before removal", async () => {
    for (const afterAck of ["clean", "edited", "replaced-document"]) {
        const f = transport(), pending = f.run()
        f.reply(); assert.equal(await pending, true)
        if (afterAck === "edited") f.finalSafe(false)
        if (afterAck === "replaced-document") f.frame.contentDocument = { ...f.frame.contentDocument }
        assert.equal(confirmWorkspaceFrameDeparture(f.frame as unknown as HTMLIFrameElement), afterAck === "clean")
        assert.equal(confirmWorkspaceFrameDeparture(f.frame as unknown as HTMLIFrameElement), false, "a confirmation is one-use; no implicit retry")
        assert.equal(f.sent.length, 1, "final validation is synchronous, without another async roundtrip")
    }
})

test("document receiver replacement, false ack, timeout and disposal all fail closed", async () => {
    for (const mode of ["document", "false", "timeout", "abort"]) {
        const f = transport(), controller = new AbortController()
        const pending = f.run(controller.signal)
        if (mode === "document") { f.attributes.set(WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE, "new"); f.reply() }
        if (mode === "false") f.reply({ safe: false })
        if (mode === "timeout") f.expire()
        if (mode === "abort") controller.abort()
        assert.equal(await pending, false, mode)
        assert.equal(f.listeners.size, 0); assert.equal(f.timers.size, 0)
    }
})

test("missing receivers allow initial blank/error recovery but never infer safety for a formerly live page", async () => {
    const f = transport()
    f.attributes.clear()
    assert.equal(await f.run(), false, "ordinary loading is not proof of no owner")
    f.frame.contentDocument.URL = "about:blank"
    assert.equal(await f.run(), true)
    f.frame.contentDocument.URL = "https://fixture.test/error"
    f.attributes.set(WORKSPACE_FRAME_ERROR_ATTRIBUTE, "true")
    assert.equal(await f.run(), true, "a never-live committed error page is retryable")
    f.attributes.set(WORKSPACE_FRAME_PAGE_ATTRIBUTE, "true")
    assert.equal(await f.run(), false, "a lost receiver after usable content must retain its owner")
})

test("speculative checkpoints never run a network flusher and preserve unsupported or failed owners", async () => {
    let saves = 0, checkpoints = 0
    assert.equal(checkpointWorkspaceAutosaves(), true)
    const supported = registerWorkspaceAutosaveFlusher(async () => { saves++ }, { checkpoint: () => { checkpoints++; return true } })
    assert.equal(checkpointWorkspaceAutosaves(), true)
    const legacy = registerWorkspaceAutosaveFlusher(async () => { saves++ })
    assert.equal(checkpointWorkspaceAutosaves(), false)
    legacy()
    const failed = registerWorkspaceAutosaveFlusher(async () => { saves++ }, { checkpoint: () => false })
    assert.equal(checkpointWorkspaceAutosaves(), false)
    failed(); supported()
    assert.equal(saves, 0); assert.ok(checkpoints > 0)
    const f = transport(), pending = f.run(undefined, true)
    assert.equal(f.sent[0].checkpointOnly, true)
    f.reply(); assert.equal(await pending, true)
})

test("residency preflights only displaced owners and excludes an explicitly closed tab", () => {
    assert.deepEqual(workspaceResidentEvictions(["a", "b", "c"], "d", 3), ["c"])
    assert.deepEqual(workspaceResidentEvictions(["a", "b", "c"], "b", 3), [])
    assert.deepEqual(workspaceResidentEvictions(["a", "b", "c"], "d", 3, "b"), [])
})

const shell = ts.createSourceFile("shell.tsx", readFileSync("components/workspace/WorkspaceTopBarClient.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function evaluate(name: string, context: Record<string, unknown>) {
    let node: ts.Node | undefined
    function visit(item: ts.Node) {
        if ((ts.isFunctionDeclaration(item) && item.name?.text === name) || (ts.isVariableDeclaration(item) && item.name.getText(shell) === name)) node = item
        ts.forEachChild(item, visit)
    }
    visit(shell); assert.ok(node)
    const code = ts.isVariableDeclaration(node) ? `const ${node.getText(shell)};` : node.getText(shell)
    return new Function(...Object.keys(context), ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + `; return ${name};`)(...Object.values(context))
}

test("the actual shell Retry invokes the final confirmation; a truthy permission cannot bypass refusal", async () => {
    for (const safe of [false, () => false, () => true]) {
        const changes: string[] = []
        let release!: (safe: boolean | (() => boolean)) => void
        const retry = evaluate("retryActiveNavigation", {
            activeNavigation: { requestedUrl: "/fixture/assets" }, activeTabId: "tab",
            prepareNativeLeave: () => new Promise<boolean | (() => boolean)>((resolve) => { release = resolve }),
            beginTabNavigation: () => changes.push("begin"), updateTabForShellNavigation: () => changes.push("route"),
            pendingNavigationRef: { current: new Map() }, nativeRefs: { current: new Map() }, postToTab: () => changes.push("post"),
            ensureTabFrameLocation: () => changes.push("replace"),
        })
        const pending = retry()
        assert.deepEqual(changes, [])
        release(safe); await pending
        assert.deepEqual(changes, typeof safe === "function" && safe() ? ["begin", "route", "replace"] : [])
    }
})

test("actual iframe-to-native shell navigation supplies the destination before changing route state", async () => {
    const changes: string[] = []
    const navigate = evaluate("navigateActiveTab", {
        startNativeNavigation() {}, nativeNavigationPerformance: { finish() {} },
        activeTabIdRef: { current: "tab" }, normalizeWorkspaceUrl: (url: string) => url,
        prepareNativeLeave: async (options: unknown) => { assert.deepEqual(options, { destination: { tabId: "tab", url: "/fixture/assets" } }); return false },
        setMobileContextKey: () => changes.push("context"), updateTabForShellNavigation: () => changes.push("route"),
    })
    await navigate("/fixture/assets")
    assert.deepEqual(changes, [])
})

test("actual frame close consults the exact closing owner before removing it", async () => {
    const tabs = [{ id: "live" }, { id: "closing" }]
    const close = evaluate("closeTab", {
        tabsRef: { current: tabs }, activeTabIdRef: { current: "live" }, prepareNativeLeave: async (options: unknown) => { assert.deepEqual(options, { closeTabId: "closing", activateTabId: "live" }); return false },
        closedTabsRef: { current: [] },
    })
    await close("closing")
    assert.equal(tabs.length, 2)
})

test("actual shell native Retry dispatches a boundary retry rather than an ordinary refresh", async () => {
    const messages: unknown[] = []
    const retry = evaluate("retryActiveNavigation", {
        activeNavigation: { requestedUrl: "/fixture/assets" }, activeTabId: "tab", prepareNativeLeave: async () => () => true,
        beginTabNavigation() {}, updateTabForShellNavigation() {}, pendingNavigationRef: { current: new Map() },
        nativeRefs: { current: new Map([["tab", {}]]) }, postToTab: (...args: unknown[]) => messages.push(args),
        ensureTabFrameLocation: () => assert.fail("native Retry must not reload the workspace"),
    })
    await retry()
    assert.deepEqual(messages, [["tab", { type: "retry" }]])
})

test("actual departure fences rapid intents and aborts an older eviction acknowledgement", async () => {
    const calls: Array<{ tabId: string; signal: AbortSignal; resolve: (safe: boolean) => void }> = []
    const errors: string[] = []
    const context = {
        useCallback: (fn: unknown) => fn, nativeNavigationSequence: { current: 0 }, warmAbortRef: { current: null }, departureAbortRef: { current: null },
        residentTabIdsRef: { current: ["a", "b", "c"] }, MAX_RESIDENT_WORKSPACE_FRAMES: 3, workspaceResidentEvictions,
        iframeRefs: { current: new Map([...["a", "b", "c"].map((id) => [id, {}])]) }, nativeRefs: { current: new Map() }, activeTabIdRef: { current: "a" },
        prepareWorkspaceFrameDeparture: (_frame: unknown, tabId: string, _host: unknown, signal: AbortSignal) => new Promise<boolean>((resolve) => {
            calls.push({ tabId, signal, resolve }); signal.addEventListener("abort", () => resolve(false), { once: true })
        }),
        window: {}, nativePanelsEnabled: true, workspace: { slug: "fixture" },
        setBackgroundMutationState() {}, setBackgroundMutationError: (error: string) => errors.push(error),
        flushWorkspaceAutosaves: () => assert.fail("iframe departures do not use a shell-global flusher"),
        confirmWorkspaceFrameDeparture: () => true,
    }
    const prepare = evaluate("prepareNativeLeave", context)
    const older = prepare({ activateTabId: "d" })
    assert.equal(calls[0].tabId, "c")
    const latest = prepare({ closeTabId: "b" })
    assert.equal(calls[0].signal.aborted, true)
    assert.equal(calls[1].tabId, "b")
    calls[0].resolve(true); calls[1].resolve(true)
    assert.equal(await older, false); assert.equal((await latest)(), true)
    assert.equal(context.departureAbortRef.current, null)
    assert.deepEqual(errors, [], "a superseded intent does not display a stale save error")
})

test("actual full-pool warming evicts only after a durable checkpoint, without a network save", async () => {
    for (const safe of [false, true]) {
        let release!: (safe: boolean) => void
        const residents = { current: ["a", "b", "c"] }
        const original = residents.current
        const updates: unknown[] = []
        const warm = evaluate("warmWorkspaceTab", {
            useCallback: (fn: unknown) => fn, activeTabIdRef: { current: "a" }, departureAbortRef: { current: null }, warmAbortRef: { current: null },
            tabsRef: { current: ["a", "b", "c", "d"].map((id) => ({ id })) }, residentTabIdsRef: residents, MAX_RESIDENT_WORKSPACE_FRAMES: 3,
            iframeRefs: { current: new Map([["c", {}]]) }, nativeRefs: { current: new Map() }, window: {},
            prepareWorkspaceFrameDeparture: (_frame: unknown, tabId: string, _window: unknown, signal: AbortSignal, checkpointOnly: boolean) => {
                assert.equal(tabId, "c"); assert.equal(checkpointOnly, true); assert.equal(signal.aborted, false)
                return new Promise<boolean>((resolve) => { release = resolve })
            },
            checkpointWorkspaceAutosaves: () => assert.fail("iframe owns its checkpoint"),
            confirmWorkspaceFrameDeparture: () => true,
            setResidentTabIds: (value: unknown) => updates.push(value),
        })
        const pending = warm("d")
        assert.equal(residents.current, original, "a pending checkpoint must retain the old owner")
        assert.deepEqual(updates, [])
        release(safe); await pending
        assert.deepEqual(residents.current, safe ? ["a", "d", "b"] : ["a", "b", "c"])
        assert.equal(updates.length, safe ? 1 : 0)
        assert.equal(residents.current.length, 3)
    }
})

test("actual account clearing invalidates pending departures and speculative warming", async () => {
    let listener!: (event: unknown) => void
    let node: ts.CallExpression | undefined
    function visit(item: ts.Node) {
        if (ts.isCallExpression(item) && item.expression.getText(shell) === "useEffect" && item.arguments[0]?.getText(shell).includes('window.addEventListener("betelgeze:offline-account-clearing"')) node = item
        ts.forEachChild(item, visit)
    }
    visit(shell); assert.ok(node)
    const sequence = { current: 4 }, departure = new AbortController(), warm = new AbortController()
    const context = {
        window: { addEventListener: (_type: string, callback: typeof listener) => { listener = callback }, removeEventListener() {} },
        currentUserId: "me", nativeNavigationSequence: sequence, departureAbortRef: { current: departure }, warmAbortRef: { current: warm },
        navigationTimeoutRef: { current: new Map() }, pendingNavigationRef: { current: new Map() }, navigationErrorRef: { current: new Map() },
        setClearedNativeAccount() {}, nativeAccountScope: "me:fixture", nativeNavigationPerformance: { cancel() {} }, nativeCache: { clear() {} }, nativeScrollPositions: { clear() {} },
    }
    const javascript = ts.transpileModule(`const run = ${node.arguments[0].getText(shell)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const cleanup = new Function(...Object.keys(context), `${javascript}; return run();`)(...Object.values(context))
    listener({ detail: { preservedUserId: "me" } })
    assert.equal(sequence.current, 4); assert.equal(departure.signal.aborted, false)
    listener({ detail: { preservedUserId: "other" } })
    assert.equal(sequence.current, 5); assert.equal(departure.signal.aborted, true); assert.equal(warm.signal.aborted, true)
    cleanup()
})

test("actual successful close bounds frame/context bookkeeping while preserving reopen state and other tabs", async () => {
    const tabs = [{ id: "live" }, { id: "closing" }], removed: string[] = []
    const closed = { current: Array.from({ length: 20 }, (_, i) => ({ tab: { id: `old-${i}` } })) }
    const order = { current: ["live", "closing"] }, residents = { current: ["live", "closing"] }
    let contextOpen: Record<string, boolean> = { live: false, closing: false }
    const fixture = {
        tabsRef: { current: tabs }, activeTabId: "live", prepareNativeLeave: async () => () => true, closedTabsRef: closed,
        contextOpenByTab: contextOpen, tabFrameOrderRef: order, setTabFrameOrder() {}, residentTabIdsRef: residents,
        shellStorage: { remove: (key: string) => removed.push(key) }, workspaceTabContextStorageKey: (_slug: string, id: string) => `context:${id}`, workspace: { slug: "fixture" },
        setContextOpenByTab: (update: (value: typeof contextOpen) => typeof contextOpen) => { contextOpen = update(contextOpen) },
        loadedTabIdsRef: { current: new Set() }, readyTabIdsRef: { current: new Set() }, pendingNavigationRef: { current: new Map() },
        navigationTimeoutRef: { current: new Map() }, softNavigationFallbackRef: { current: new Map() }, navigationFallbackRef: { current: new Map() }, navigationErrorRef: { current: new Map() }, mutationIdsByTabRef: { current: new Map() },
        setLoadedTabIds() {}, routeLoadingTabId: null, setRefreshingTabIds() {}, setNavigationStateByTab() {}, setBackgroundMutationCounts() {},
        contextStatusByTabRef: { current: { closing: {} } }, contextManualClosedByTabRef: { current: { closing: true } }, contextObstructedByTabRef: { current: { closing: true } },
        setContextStatusByTab() {}, setContextObstructedByTab() {}, activeTabIdRef: { current: "live" }, setTabs() {}, activateWorkspaceTab() {}, saveTabsState() {},
    }
    await evaluate("closeTab", fixture)("closing")
    assert.deepEqual(order.current, ["live"]); assert.deepEqual(residents.current, ["live"])
    assert.deepEqual(removed, ["context:closing"]); assert.deepEqual(contextOpen, { live: false })
    assert.equal(closed.current.length, 20)
    assert.deepEqual(closed.current.at(-1), { tab: tabs[1], index: 1, contextOpen: false })
    assert.deepEqual(fixture.contextStatusByTabRef.current, {})
})

test("actual A-B-A switching cancels a delayed B departure without changing activation", async () => {
    const current = { current: "a" }, sequence = { current: 0 }, departure = { current: null as AbortController | null }
    const activations: string[] = []
    let release!: (safe: boolean) => void
    const tabs = { current: ["a", "b"].map((id) => ({ id, url: `/${id}`, seenRevision: 0 })) }
    const prepare = evaluate("prepareNativeLeave", {
        useCallback: (fn: unknown) => fn, nativeNavigationSequence: sequence, warmAbortRef: { current: null }, departureAbortRef: departure,
        residentTabIdsRef: { current: ["a", "c", "d"] }, MAX_RESIDENT_WORKSPACE_FRAMES: 3, workspaceResidentEvictions,
        iframeRefs: { current: new Map([["d", {}]]) }, nativeRefs: { current: new Map() }, activeTabIdRef: current,
        prepareWorkspaceFrameDeparture: () => new Promise<boolean>((resolve) => { release = resolve }), window: {}, nativePanelsEnabled: true, workspace: { slug: "fixture" },
        setBackgroundMutationState() {}, setBackgroundMutationError() {},
    })
    const switchTab = evaluate("switchTab", {
        useCallback: (fn: unknown) => fn, activeTabIdRef: current, nativeNavigationSequence: sequence, departureAbortRef: departure, warmAbortRef: { current: null },
        startNativeNavigation() {}, nativeNavigationPerformance: { cancel() {}, finish() {} }, prepareNativeLeave: prepare,
        tabsRef: tabs, mutationRevisionRef: { current: 0 }, setTabs() {}, activateWorkspaceTab: (id: string) => activations.push(id), saveTabsState() {}, postToTab() {}, window: { requestAnimationFrame() {} },
    })
    const pending = switchTab(tabs.current[1])
    await switchTab(tabs.current[0])
    release(true); await pending
    assert.equal(current.current, "a"); assert.deepEqual(activations, []); assert.equal(departure.current, null)
})

test("actual switching retains metadata changed while departure was pending", async () => {
    const tabs = { current: ["a", "b"].map((id) => ({ id, url: `/${id}`, title: id, seenRevision: 0 })) }
    let release!: (safe: () => boolean) => void
    const switchTab = evaluate("switchTab", {
        useCallback: (fn: unknown) => fn, activeTabIdRef: { current: "a" }, startNativeNavigation() {}, nativeNavigationPerformance: { finish() {} },
        prepareNativeLeave: () => new Promise<() => boolean>((resolve) => { release = resolve }), tabsRef: tabs, mutationRevisionRef: { current: 0 },
        setTabs: (value: typeof tabs.current) => { tabs.current = value }, activateWorkspaceTab() {}, saveTabsState() {}, postToTab() {}, window: { requestAnimationFrame() {} },
    })
    const pending = switchTab(tabs.current[1])
    tabs.current = tabs.current.map((tab) => ({ ...tab, title: `Renamed ${tab.id}` }))
    release(() => true); await pending
    assert.deepEqual(tabs.current.map((tab) => tab.title), ["Renamed a", "Renamed b"])
})
