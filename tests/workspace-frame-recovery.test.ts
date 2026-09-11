import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { workspaceNavigationReadyMatches } from "../lib/workspace-navigation-lifecycle.ts"

// Execute the production callbacks with deterministic host/frame events.
// No network or string-presence assertion substitutes for their behavior.
const path = "components/workspace/WorkspaceTopBarClient.tsx"
const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(predicate: (node: ts.Node) => boolean) {
    const found: ts.Node[] = []
    function visit(node: ts.Node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit) }
    visit(source)
    assert.equal(found.length, 1)
    return found[0]
}
function declaration(name: string) {
    const node = find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === name)
    return `const ${node.getText(source)};`
}
function fn(name: string) {
    return find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source)
}
function evaluate(code: string, context: Record<string, unknown>, result = "undefined") {
    const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
    return new Function(...Object.keys(context), `${js}\nreturn ${result}`)(...Object.values(context))
}
const ref = <T,>(current: T) => ({ current })

test("server revalidation retains the launch identity and mounted frame ref", () => {
    let state: unknown
    let deps: unknown[] | undefined
    let callback: unknown
    const context = {
        useState: (init: () => unknown) => [state ??= init()],
        useCallback: (next: unknown, values: unknown[]) => {
            if (!deps || values.some((v, i) => v !== deps![i])) callback = next
            deps = values
            return callback
        },
        iframeRefs: ref(new Map()), loadedTabIdsRef: ref(new Set()), readyTabIdsRef: ref(new Set()),
        setLoadedTabIds() {}, setRefreshingTabIds() {}, markWorkspaceLaunch() {},
    }
    const code = declaration("[initialTab]") + declaration("assignTabFrameRef")
    const first = evaluate(code, { ...context, bootstrapTab: { id: "original" } }, "({initialTab, assignTabFrameRef})")
    const afterRefresh = evaluate(code, { ...context, bootstrapTab: { id: "new-server-id" } }, "({initialTab, assignTabFrameRef})")
    assert.equal(afterRefresh.initialTab, first.initialTab)
    assert.equal(afterRefresh.assignTabFrameRef, first.assignTabFrameRef, "React must not detach the unchanged iframe")
})

test("a newly mounted iframe cannot inherit readiness from the native renderer", () => {
    const loaded = ref(new Set(["tab"])), ready = ref(new Set(["tab"]))
    let visible = new Set(["tab"])
    const assign = evaluate(declaration("assignTabFrameRef"), {
        useCallback: (value: unknown) => value, initialTab: { id: "initial" },
        iframeRefs: ref(new Map()), loadedTabIdsRef: loaded, readyTabIdsRef: ready,
        setLoadedTabIds: (update: (set: Set<string>) => Set<string>) => { visible = update(visible) },
        setRefreshingTabIds() {}, markWorkspaceLaunch() {},
    }, "assignTabFrameRef")
    assign("tab", {})
    assert.equal(loaded.current.size, 0)
    assert.equal(ready.current.size, 0)
    assert.equal(visible.size, 0)
})

test("the delayed fallback probes a slow transition without issuing another navigation", () => {
    const callbacks: Array<() => void> = []
    const pending = ref(new Map([["tab", "/target"]]))
    const messages: unknown[] = []
    const schedule = evaluate(declaration("scheduleSoftNavigationFallback"), {
        useCallback: (value: unknown) => value, softNavigationFallbackRef: ref(new Map()),
        pendingNavigationRef: pending, WORKSPACE_NAVIGATION_PROBE_MS: 8_000,
        window: { setTimeout: (cb: () => void, ms: number) => { assert.equal(ms, 8_000); callbacks.push(cb); return callbacks.length }, clearTimeout() {} },
        postToTab: (...args: unknown[]) => messages.push(args),
        ensureTabFrameLocation: () => assert.fail("a timer must not navigate the frame"),
    }, "scheduleSoftNavigationFallback")
    schedule("tab", "/target")
    callbacks[0]()
    assert.deepEqual(messages, [["tab", { type: "probe" }]])
    schedule("tab", "/target")
    pending.current.set("tab", "/newer")
    callbacks[1]()
    assert.equal(messages.length, 1, "superseded work does not probe or navigate")
})

test("late iframe load probes readiness without rolling back a changed location", () => {
    const messages: unknown[] = []
    const load = evaluate(fn("handleFrameLoad"), {
        initialTab: { id: "tab" }, activeTabIdRef: ref("tab"), markWorkspaceLaunch() {},
        postToTab: (...args: unknown[]) => messages.push(args),
        ensureTabFrameLocation: () => assert.fail("load must not restart the document"),
        completeTabNavigation: () => assert.fail("load is not bridge readiness"),
    }, "handleFrameLoad")
    load("tab", "/outdated-route")
    assert.deepEqual(messages, [["tab", { type: "probe" }], ["tab", { type: "activate", active: true, refresh: false }]])
})

function receiverFixture(native = false) {
    const frameWindow = {}
    const pending = ref(new Map([["tab", "/target"]]))
    const errors = ref(new Map<string, string>())
    const timers = ref(new Map())
    let navigation: Record<string, unknown> = { tab: { status: "loading" } }
    let tabs = [{ id: "tab", url: "/target", title: "Target", history: ["/old", "/target"], historyIndex: 1 }]
    const tabsRef = ref(tabs)
    let loaded = 0
    const messages: unknown[] = []
    const context = {
        workspaceNavigationReadyMatches, useCallback: (v: unknown) => v,
        document: { visibilityState: "visible" }, window: { location: { origin: "https://fixture.test" }, clearTimeout() {}, requestAnimationFrame: () => assert.fail("stale readiness must not replay navigation") },
        WORKSPACE_TAB_MESSAGE_SOURCE: "fixture", iframeRefs: ref(new Map([["tab", { contentWindow: frameWindow }]])),
        nativeRefs: ref(new Map(native ? [["tab", {}]] : [])), tabsRef,
        pendingNavigationRef: pending, navigationErrorRef: errors, navigationTimeoutRef: timers,
        softNavigationFallbackRef: ref(new Map()), navigationFallbackRef: ref(new Map()),
        readyTabIdsRef: ref(new Set()), activeTabIdRef: ref("tab"),
        normalizeWorkspaceUrl: (v: string) => v, markTabFrameReady: () => { loaded++ },
        postToTab: (...args: unknown[]) => messages.push(args), reportInitialPanelReady() {}, setRouteLoadingTabId() {},
        nativeNavigationPerformance: { finishTarget() {} }, titleForUrl: () => "Target", saveTabsState() {},
        routeCanShowRelationshipContext: () => false, setTabContextStatus() {}, setTabContextOpen() {},
        setTabs: (update: (value: typeof tabs) => typeof tabs) => { tabs = update(tabs); tabsRef.current = tabs },
        setNavigationStateByTab: (update: (value: typeof navigation) => typeof navigation) => { navigation = update(navigation) },
    }
    const receive = evaluate(declaration("completeTabNavigation") + fn("receiveFrameMessage"), context, "receiveFrameMessage")
    return {
        pending, errors, state: () => ({ navigation, loaded, messages, tabs }),
        send(type: string, url: string) { receive({ origin: "https://fixture.test", source: frameWindow, data: { source: "fixture", target: "host", tabId: "tab", type, url } }, native) },
    }
}

test("an old probe response cannot restart an in-flight transition or reveal its old content", () => {
    const fixture = receiverFixture()
    fixture.send("location", "/old")
    assert.equal(fixture.pending.current.get("tab"), "/target")
    assert.equal(fixture.state().loaded, 0)
    assert.equal(fixture.state().messages.length, 0)
    fixture.send("location", "/target")
    assert.equal(fixture.pending.current.size, 0)
    assert.equal(fixture.state().loaded, 1)
    assert.deepEqual(fixture.state().navigation, {})
})

test("native failure immediately ends loading; only the matching retry can clear the error", () => {
    const fixture = receiverFixture(true)
    fixture.send("navigation-failed", "/old")
    assert.equal(fixture.errors.current.size, 0)
    fixture.send("navigation-failed", "/target")
    assert.equal((fixture.state().navigation.tab as { status: string }).status, "error")
    assert.equal(fixture.pending.current.size, 0)
    fixture.send("location", "/old")
    assert.equal(fixture.errors.current.size, 1)
    fixture.send("location", "/target")
    assert.equal(fixture.errors.current.size, 0)
    assert.deepEqual(fixture.state().navigation, {})
})

test("a late committed frame URL replacement clears the previous timeout", () => {
    const fixture = receiverFixture()
    fixture.errors.current.set("tab", "/target")
    fixture.pending.current.clear()
    fixture.send("location-replace", "/target?conversation=selected")
    assert.equal(fixture.state().tabs[0].url, "/target?conversation=selected")
    assert.equal(fixture.state().loaded, 1)
    assert.equal(fixture.errors.current.size, 0)
    assert.deepEqual(fixture.state().navigation, {})
})

test("first/new/restored tabs get a deadline and bounded probes; warm tabs do no recovery work", () => {
    const effect = find((node) => ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && Boolean(node.arguments[0]?.getText(source).includes('const timeouts = [0, 250,'))) as ts.CallExpression
    for (const warm of [false, true]) {
        const timers: Array<() => void> = []
        const loaded = ref(new Set(warm ? ["restored"] : []))
        const pending = ref(new Map())
        let deadlines = 0, probes = 0
        const cleanup = evaluate(`const run = ${effect.arguments[0].getText(source)};`, {
            tabsHydrated: true, activeTabId: "restored", loadedTabIdsRef: loaded,
            tabsRef: ref([{ id: "restored", url: "/target" }]), navigationErrorRef: ref(new Map()), pendingNavigationRef: pending,
            beginTabNavigation: () => { deadlines++ }, postToTab: () => { probes++ },
            window: { setTimeout: (cb: () => void) => { timers.push(cb); return timers.length }, clearTimeout() {}, addEventListener() {}, removeEventListener() {} },
            document: { addEventListener() {}, removeEventListener() {} },
        }, "run()")
        if (warm) { assert.equal(deadlines, 0); assert.equal(timers.length, 0); continue }
        assert.equal(deadlines, 1)
        assert.equal(pending.current.get("restored"), "/target")
        assert.equal(timers.length, 5)
        timers[0]()
        assert.equal(probes, 1)
        loaded.current.add("restored")
        timers.slice(1).forEach((cb) => cb())
        assert.equal(probes, 1, "a completed tab gets no more probes")
        cleanup()
    }
})
