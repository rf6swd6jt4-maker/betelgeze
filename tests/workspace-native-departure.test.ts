import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { appendWorkspaceTabHistory } from "../lib/workspace-tabs.ts"
import { captureWorkspaceAutosaveDepartureCheck, flushWorkspaceAutosaves, registerWorkspaceAutosaveFlusher, WORKSPACE_MUTATION_INTENT_START } from "../lib/workspace-mutations.ts"

function callback(path: string, name: string, context: Record<string, unknown>) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let found: ts.VariableDeclaration | undefined
    function visit(node: ts.Node) { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node; ts.forEachChild(node, visit) }
    visit(source); assert.ok(found)
    const code = ts.transpileModule(`const ${found.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    return new Function(...Object.keys(context), `${code};return ${name}`)(...Object.values(context))
}

function fixture() {
    const events = new EventTarget(), assignments: string[] = [], messages: Array<Record<string, unknown>> = [], errors: Array<string | null> = [], creates: string[] = []
    const window = { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events), setTimeout, clearTimeout, location: { origin: "https://fixture.test", assign: (url: string) => assignments.push(url) } }
    const initial = { id: "tab", url: "/fixture/assets/one", title: "One", history: ["/fixture/assets", "/fixture/assets/one"], historyIndex: 1 }
    const tabsRef = { current: [initial] }, mounted = { current: true }, owner = {}, nativeRefs = { current: new Map([["tab", { owner }]]) }
    const current = { current: { tab: initial, active: true, accountCleared: false, userId: "user", workspaceId: "workspace" } }
    const scope = { current: "user:workspace" }, hostSequence = { current: 0 }, childSequence = { current: 0 }
    let syncDepth = 0, syncCommits = 0, saves = 0
    let release!: (safe: boolean) => void
    const save = new Promise<boolean>((resolve) => { release = resolve })
    const unregister = registerWorkspaceAutosaveFlusher(async () => { saves++; window.dispatchEvent(new Event(WORKSPACE_MUTATION_INTENT_START)); return save })
    const prepareNavigation = callback("components/workspace/WorkspaceTopBarClient.tsx", "prepareNativePanelNavigation", {
        useCallback: (fn: unknown) => fn, nativeRefs, activeTabIdRef: { current: "tab" }, tabsRef,
        currentUserId: "user", workspace: { id: "workspace", slug: "fixture" }, nativeAccountScopeRef: scope, nativeAccountScope: scope.current, clearedNativeAccount: null,
        window, normalizeWorkspaceUrl: (url: string) => url, nativeNavigationSequence: hostSequence, departureAbortRef: { current: null }, warmAbortRef: { current: null },
        openCreate: (value: string) => creates.push(value), nativeNavigationPerformance: { finishSource() {} },
        beginTabNavigation() {}, pendingNavigationRef: { current: new Map() }, titleForUrl: (url: string) => url, appendWorkspaceTabHistory,
        setTabs: (tabs: typeof tabsRef.current) => { assert.equal(syncDepth, 1, "route changes happen inside the synchronous commit"); tabsRef.current = tabs; current.current.tab = tabs[0] },
        saveTabsState() {}, readyTabIdsRef: { current: new Set() }, scheduleSoftNavigationFallback() {},
        flushSync: (commit: () => void) => { syncCommits++; syncDepth++; try { commit() } finally { syncDepth-- } },
    })
    const navigate = callback("components/workspace/NativeWorkspaceTab.tsx", "navigate", {
        useCallback: (fn: unknown) => fn, current, mounted, navigationSequence: childSequence, tab: initial, window,
        post: (message: Record<string, unknown>) => messages.push(message), workspaceSlug: "fixture", userId: "user", workspaceId: "workspace", prepareNavigation,
        captureWorkspaceAutosaveDepartureCheck, flushWorkspaceAutosaves, setNavigationError: (value: string | null) => errors.push(value),
    })
    return { window, navigate, release, unregister, tabsRef, nativeRefs, owner, current, mounted, scope, hostSequence, messages, assignments, errors, creates, stats: () => ({ saves, syncCommits }) }
}

for (const replace of [false, true]) test(`actual native ${replace ? "replace" : "push"} saves once and validates inside its host commit`, async () => {
    const f = fixture(), previous = globalThis.window
    globalThis.window = f.window as unknown as Window & typeof globalThis
    try {
        const pending = f.navigate("/fixture/assets/two", replace)
        assert.equal(f.tabsRef.current[0].url, "/fixture/assets/one")
        f.release(true); await pending
        assert.deepEqual(f.stats(), { saves: 1, syncCommits: 1 })
        assert.equal(f.tabsRef.current[0].url, "/fixture/assets/two")
        assert.deepEqual(f.tabsRef.current[0].history, replace ? ["/fixture/assets", "/fixture/assets/two"] : ["/fixture/assets", "/fixture/assets/one", "/fixture/assets/two"])
        assert.equal(f.messages.some((message) => ["navigation-start", "location-replace"].includes(String(message.type))), false, "the old message bypass is unused")
        assert.deepEqual(f.errors, [null], "the successful save's own mutation event must not cause refusal")
    } finally { f.unregister(); globalThis.window = previous }
})

for (const change of ["edit", "host-intent", "owner", "account", "unmount", "renew-handle"]) test(`actual native departure fences ${change}`, async () => {
    const f = fixture(), previous = globalThis.window
    globalThis.window = f.window as unknown as Window & typeof globalThis
    try {
        const pending = f.navigate("/fixture/assets/two")
        if (change === "edit") f.window.dispatchEvent(new Event("input"))
        if (change === "host-intent") f.hostSequence.current++
        if (change === "owner") f.nativeRefs.current.set("tab", { owner: {} })
        if (change === "account") { f.scope.current = "other:workspace"; f.current.current.userId = "other" }
        if (change === "unmount") f.mounted.current = false
        if (change === "renew-handle") f.nativeRefs.current.set("tab", { owner: f.owner })
        f.release(true); await pending
        assert.equal(f.tabsRef.current[0].url, change === "renew-handle" ? "/fixture/assets/two" : "/fixture/assets/one")
        assert.equal(f.stats().saves, 1)
        if (change === "edit") assert.match(f.errors[0]!, /not safely saved/)
        if (["host-intent", "owner", "account", "unmount"].includes(change)) assert.deepEqual(f.errors, [], "cancellation is not a failed-save claim")
    } finally { f.unregister(); globalThis.window = previous }
})

test("creation keeps the owner and host generation; external assign remains an explicit document boundary", async () => {
    for (const href of ["/fixture/assets?create=note", "https://elsewhere.test/path"]) {
        const f = fixture(), previous = globalThis.window
        globalThis.window = f.window as unknown as Window & typeof globalThis
        try {
            const pending = f.navigate(href)
            f.release(true); await pending
            assert.deepEqual(f.stats(), { saves: 1, syncCommits: 0 })
            assert.equal(f.hostSequence.current, 0)
            assert.equal(f.tabsRef.current[0].url, "/fixture/assets/one")
            assert.deepEqual(f.creates, href.startsWith("/") ? ["note"] : [])
            assert.deepEqual(f.assignments, href.startsWith("/") ? [] : [href])
        } finally { f.unregister(); globalThis.window = previous }
    }
})

test("choosing the current native URL cancels older local intent without saving or committing", async () => {
    const f = fixture(), previous = globalThis.window
    globalThis.window = f.window as unknown as Window & typeof globalThis
    try {
        const pending = f.navigate("/fixture/assets/two")
        await f.navigate("/fixture/assets/one")
        f.release(true); await pending
        assert.equal(f.tabsRef.current[0].url, "/fixture/assets/one")
        assert.deepEqual(f.stats(), { saves: 1, syncCommits: 0 })
    } finally { f.unregister(); globalThis.window = previous }
})
