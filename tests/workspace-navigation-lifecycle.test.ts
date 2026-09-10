import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { createWorkspaceNavigationDeadline, workspaceNavigationReadyMatches, afterVisibleWorkspacePaint } from "../lib/workspace-navigation-lifecycle.ts"
import { createWorkspacePerformanceMeasurement } from "../lib/workspace-performance-contract.ts"

function clockFixture() {
    let now = 0, nextId = 0, visible = true, active = "tab"
    const tasks = new Map<number, { at: number; callback: () => void }>()
    const clock = {
        isForeground: () => visible && active === "tab",
        now: () => now,
        schedule: (callback: () => void, delay: number) => { const id = ++nextId; tasks.set(id, { at: now + delay, callback }); return id },
        cancel: (id: number) => { tasks.delete(id) },
    }
    return {
        clock, tasks,
        visible: (value: boolean) => { visible = value }, active: (value: string) => { active = value },
        advance: (duration: number) => {
            const until = now + duration
            for (;;) {
                const next = [...tasks].filter(([, task]) => task.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
                if (!next) break
                now = next[1].at
                tasks.delete(next[0])
                next[1].callback()
            }
            now = until
        },
    }
}

function paintFixture(initialVisible = true) {
    let visible = initialVisible, nextId = 0
    const frames = new Map<number, () => void>()
    const subscribers = new Set<() => void>()
    return {
        frames,
        environment: {
            visible: () => visible,
            requestFrame: (callback: () => void) => { const id = ++nextId; frames.set(id, callback); return id },
            cancelFrame: (id: number) => { frames.delete(id) },
            subscribe: (callback: () => void) => { subscribers.add(callback); return () => { subscribers.delete(callback) } },
        },
        visibility: (value: boolean) => { visible = value; for (const callback of subscribers) callback() },
        frame: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback()) },
    }
}

test("navigation watchdog uses 12 visible seconds, pausing hidden and inactive tabs", () => {
    const fixture = clockFixture()
    let failures = 0
    const deadline = createWorkspaceNavigationDeadline(() => failures++, fixture.clock)
    fixture.advance(3_000)
    fixture.visible(false); deadline.update()
    fixture.advance(60_000)
    assert.equal(failures, 0)
    fixture.visible(true); deadline.update()
    fixture.advance(2_000)
    fixture.active("other"); deadline.update()
    fixture.advance(60_000)
    assert.equal(failures, 0)
    fixture.active("tab"); deadline.update()
    fixture.advance(6_999)
    assert.equal(failures, 0)
    fixture.advance(1)
    assert.equal(failures, 1)
    deadline.update(); fixture.advance(30_000)
    assert.equal(failures, 1, "a real foreground failure is reported only once")
})

test("a navigation begun hidden has its whole foreground budget on return", () => {
    const fixture = clockFixture()
    fixture.visible(false)
    let failures = 0
    const deadline = createWorkspaceNavigationDeadline(() => failures++, fixture.clock)
    fixture.advance(180_000)
    assert.equal(failures, 0)
    fixture.visible(true); deadline.update()
    fixture.advance(11_999)
    assert.equal(failures, 0)
    fixture.advance(1)
    assert.equal(failures, 1)
})

test("superseded or disposed deadlines ignore already queued callbacks", () => {
    const fixture = clockFixture()
    let failures = 0
    const first = createWorkspaceNavigationDeadline(() => failures++, fixture.clock)
    const queued = [...fixture.tasks.values()][0].callback
    fixture.advance(8_000)
    first.cancel()
    createWorkspaceNavigationDeadline(() => failures++, fixture.clock)
    queued()
    fixture.advance(11_999)
    assert.equal(failures, 0)
    fixture.advance(1)
    assert.equal(failures, 1)
    queued()
    assert.equal(failures, 1)
})

test("a hidden content commit cancels UI failure while paint telemetry retains hidden time", () => {
    const fixture = clockFixture()
    const paint = paintFixture(false)
    fixture.visible(false)
    const measurement = createWorkspacePerformanceMeasurement({ sampleId: "6801c9bd-cfea-4460-8ef7-000000000001", operation: "navigation", routeSection: "relationships", renderer: "native", cacheState: "network" }, fixture.clock.now, false)
    let failures = 0
    const samples: Array<NonNullable<ReturnType<typeof measurement.finish>>> = []
    const deadline = createWorkspaceNavigationDeadline(() => failures++, fixture.clock)
    fixture.advance(2_000)
    deadline.cancel() // The real panel commits and sends location while hidden.
    const dispose = afterVisibleWorkspacePaint(() => {
        measurement.mark("meaningful_ready")
        const sample = measurement.finish("completed", "meaningful_ready")
        if (sample) samples.push(sample)
    }, paint.environment)
    fixture.advance(60_000)
    assert.equal(failures, 0)
    assert.equal(samples.length, 0)
    measurement.visibility(true); paint.visibility(true)
    fixture.advance(16); paint.frame()
    assert.equal(samples.length, 0)
    fixture.advance(16); paint.frame()
    const sample = samples[0]
    assert.ok(sample)
    assert.equal(sample.durationMs, 62_032)
    assert.equal(sample.hiddenDurationMs, 62_000)
    assert.equal(sample.startedVisible, false)
    assert.equal(sample.endedVisible, true)
    assert.equal(sample.completionBoundary, "meaningful_ready")
    dispose()
})

test("hiding between frames requires two fresh visible frames and ignores queued stale frames", () => {
    const fixture = paintFixture()
    let ready = 0
    const dispose = afterVisibleWorkspacePaint(() => ready++, fixture.environment)
    fixture.frame()
    const oldSecondFrame = [...fixture.frames.values()][0]
    fixture.visibility(false)
    oldSecondFrame()
    assert.equal(ready, 0)
    fixture.visibility(true)
    fixture.frame()
    assert.equal(ready, 0)
    fixture.frame()
    assert.equal(ready, 1)
    fixture.visibility(false); fixture.visibility(true); fixture.frame(); fixture.frame()
    assert.equal(ready, 1)
    dispose()
    const disposed = afterVisibleWorkspacePaint(() => ready++, fixture.environment)
    const queued = [...fixture.frames.values()][0]
    disposed(); queued(); fixture.frame()
    assert.equal(ready, 1, "unmounted or superseded panels cannot complete later")
})

test("readiness matches the current requested URL including queries and cannot resurrect closed tabs", () => {
    assert.equal(workspaceNavigationReadyMatches("/b?page=1", "/b?page=2", "/b?page=2"), false)
    assert.equal(workspaceNavigationReadyMatches("/b", "/c", undefined, "/c"), false)
    assert.equal(workspaceNavigationReadyMatches("/b", "/b", "/c"), false)
    assert.equal(workspaceNavigationReadyMatches("/b", undefined, undefined, "/b"), false)
    assert.equal(workspaceNavigationReadyMatches("/b", "/b", undefined, "/b"), true)
    assert.equal(workspaceNavigationReadyMatches("/fallback", "/fallback", undefined, "/failed"), false)
})

// Execute the actual shell callbacks with a deterministic clock. This protects
// the recovery/rollback integration, not just the deadline utility in isolation.
function shellFixture(native: boolean) {
    const fixture = clockFixture()
    const ref = <T,>(current: T) => ({ current })
    type Tab = { id: string; url: string; history: string[] }
    const tabsRef = ref<Tab[]>([{ id: "tab", url: "/a", history: ["/a"] }])
    const pending = ref(new Map<string, string>())
    const failures = ref(new Map<string, string>())
    const timers = ref(new Map<string, ReturnType<typeof createWorkspaceNavigationDeadline>>())
    const navigationState = new Map<string, unknown>()
    const context = {
        useCallback: (callback: unknown) => callback,
        createWorkspaceNavigationDeadline, workspaceNavigationReadyMatches,
        activeTabIdRef: ref("tab"), tabsRef, documentFrozenRef: ref(false),
        document: { get visibilityState() { return fixture.clock.isForeground() ? "visible" : "hidden" } },
        performance: { now: fixture.clock.now }, window: { setTimeout: fixture.clock.schedule, clearTimeout: fixture.clock.cancel },
        softNavigationFallbackRef: ref(new Map()), navigationTimeoutRef: timers,
        navigationErrorRef: failures, navigationFallbackRef: ref(new Map()), pendingNavigationRef: pending,
        readyTabIdsRef: ref(new Set()), nativeRefs: ref(new Map(native ? [["tab", {}]] : [])), iframeRefs: ref(new Map()),
        nativeNavigationPerformance: { finishTarget() {} }, setMobileContextKey() {}, saveTabsState() {},
        setTabs: (update: (tabs: Tab[]) => Tab[]) => { tabsRef.current = update(tabsRef.current) },
        setNavigationStateByTab: (update: (state: Record<string, unknown>) => Record<string, unknown>) => {
            const next = update(Object.fromEntries(navigationState)); navigationState.clear()
            for (const [key, value] of Object.entries(next)) navigationState.set(key, value)
        },
    }
    const path = new URL("../components/workspace/WorkspaceTopBarClient.tsx", import.meta.url)
    const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const declarations: string[] = []
    function visit(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ["beginTabNavigation", "completeTabNavigation"].includes(node.name.text)) declarations.push(`const ${node.getText(source)};`)
        ts.forEachChild(node, visit)
    }
    visit(source)
    assert.equal(declarations.length, 2)
    const javascript = ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
    const callbacks = new Function(...Object.keys(context), `${javascript}\nreturn { beginTabNavigation, completeTabNavigation };`)(...Object.values(context)) as { beginTabNavigation: (tabId: string, url: string) => void; completeTabNavigation: (tabId: string, url?: string) => void }
    return {
        ...fixture, tabsRef, pending, failures, timers, navigationState,
        begin(url: string) { pending.current.set("tab", url); callbacks.beginTabNavigation("tab", url); tabsRef.current = [{ id: "tab", url, history: ["/a", url] }] },
        ready(url: string) {
            if (native && !workspaceNavigationReadyMatches(url, tabsRef.current[0]?.url, pending.current.get("tab"), failures.current.get("tab"))) return
            if (pending.current.get("tab") === url) pending.current.delete("tab")
            callbacks.completeTabNavigation("tab", url)
        },
    }
}

test("actual native shell retains a timed-out destination and clears only its matching late result", () => {
    const shell = shellFixture(true)
    shell.begin("/b")
    shell.advance(12_000)
    assert.equal(shell.tabsRef.current[0].url, "/b")
    assert.equal(shell.failures.current.get("tab"), "/b")
    assert.ok(shell.navigationState.has("tab"))
    shell.ready("/a")
    assert.equal(shell.failures.current.get("tab"), "/b")
    shell.ready("/b")
    assert.equal(shell.failures.current.size, 0)
    assert.equal(shell.navigationState.size, 0)
})

test("actual shell ignores a superseded late result and preserves genuine legacy rollback errors", () => {
    const shell = shellFixture(true)
    shell.begin("/b")
    shell.advance(12_000)
    shell.begin("/c")
    shell.ready("/b")
    assert.equal(shell.tabsRef.current[0].url, "/c")
    assert.equal(shell.pending.current.get("tab"), "/c")
    shell.advance(12_000)
    shell.ready("/b")
    assert.equal(shell.failures.current.get("tab"), "/c")
    shell.ready("/c")
    assert.equal(shell.navigationState.size, 0)
    const legacy = shellFixture(false)
    legacy.begin("/b")
    legacy.advance(12_000)
    assert.equal(legacy.tabsRef.current[0].url, "/a")
    legacy.ready("/a")
    assert.equal(legacy.failures.current.get("tab"), "/b")
    assert.ok(legacy.navigationState.has("tab"))
})

test("actual shell content readiness while hidden cancels the remaining deadline", () => {
    const shell = shellFixture(true)
    shell.begin("/b")
    shell.advance(2_000)
    shell.visible(false); shell.timers.current.get("tab")!.update()
    shell.advance(60_000)
    assert.equal(shell.failures.current.size, 0)
    shell.ready("/b")
    assert.equal(shell.timers.current.size, 0)
    assert.equal(shell.navigationState.size, 0)
    shell.visible(true)
    shell.advance(30_000)
    assert.equal(shell.failures.current.size, 0)
})
