import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { afterVisibleWorkspacePaint, workspaceNavigationReadyMatches } from "../lib/workspace-navigation-lifecycle.ts"

type Phase = "layout" | "passive"
type Effect = { phase: Phase; depth: number; create: () => void | (() => void) }
const nativePath = "components/workspace/NativeWorkspaceTab.tsx"
const hostPath = "components/workspace/WorkspaceTopBarClient.tsx"
const source = (path: string) => ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const nativeSource = source(nativePath)
const hostSource = source(hostPath)

function nodesMatching<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T) {
    const matches: T[] = []
    function visit(node: ts.Node) { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit) }
    visit(root)
    return matches
}
function effectSource(root: ts.SourceFile, marker: string) {
    const matches = nodesMatching(root, (node): node is ts.CallExpression => ts.isCallExpression(node)
        && ts.isIdentifier(node.expression) && ["useEffect", "useLayoutEffect"].includes(node.expression.text)
        && Boolean(node.arguments[0]?.getText(root).includes(marker)))
    assert.equal(matches.length, 1, `one actual production effect for ${marker}`)
    const effect = matches[0]
    // Re-render explicitly below. Keep the production hook and callback body;
    // only omit its dependency array, whose values live outside this fixture.
    return `${effect.expression.getText(root)}(${effect.arguments[0].getText(root)});`
}
function declarations(root: ts.SourceFile, names: string[]) {
    return names.map((name) => {
        const matches = nodesMatching(root, (node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name)
        assert.equal(matches.length, 1)
        return `const ${matches[0].getText(root)};`
    }).join("\n")
}
function evaluate(code: string, context: Record<string, unknown>, result = "undefined") {
    const javascript = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
    return new Function(...Object.keys(context), `${javascript}\nreturn ${result};`)(...Object.values(context))
}

// Drive the actual Ready component, NativeWorkspaceTab handle effect and shell
// receiver/completion callbacks. React runs child passive effects before parent
// passive effects, after every layout effect. No RAF is allowed in this hidden
// document: success must come from committed content, not the paint fallback.
function handshakeFixture(downgrade?: "host" | "native") {
    const ref = <T,>(current: T) => ({ current })
    const tabId = "native-tab"
    type Tab = { id: string; url: string; title: string; history: string[]; historyIndex: number }
    type Message = { source: string; target: string; tabId: string; type: string; url?: string }
    type Handle = { post: (message: { type: string; active?: boolean; refresh?: boolean }) => void }
    let tab: Tab = { id: tabId, url: "/example/relationships", title: "Relationships", history: ["/example/relationships"], historyIndex: 0 }
    const tabsRef = ref([tab])
    const current = ref({ tab, active: true, accountCleared: false })
    const activeTabIdRef = ref(tabId)
    const nativeRefs = ref(new Map<string, Handle>())
    const nativeMessageRef = ref<(message: Message) => void>(() => {})
    const pendingNavigationRef = ref(new Map<string, string>())
    const committedUrl = ref<string | null>(null)
    const navigationErrorRef = ref(new Map<string, string>())
    const navigationTimeoutRef = ref(new Map())
    let navigationState: Record<string, { status: string; requestedUrl: string }> = {}
    let contentAcknowledgements = 0, paintAcknowledgements = 0
    let effects: Effect[] = [], cleanups: Array<() => void> = []
    let lateMounted: () => void = () => {}
    const window = Object.assign(new EventTarget(), {
        location: { origin: "https://example.test" },
        clearTimeout() {},
        requestAnimationFrame() { throw new Error("Hidden readiness cannot rely on a frame") },
    })
    const document = Object.assign(new EventTarget(), { visibilityState: "hidden" })
    const hooks = (depth: number, forcePassive = false) => ({
        useCallback: (callback: unknown) => callback,
        useLayoutEffect: (create: Effect["create"]) => { effects.push({ phase: forcePassive ? "passive" : "layout", depth, create }) },
        useEffect: (create: Effect["create"]) => { effects.push({ phase: "passive", depth, create }) },
    })
    const shared = {
        window, document, workspaceNavigationReadyMatches, tabsRef, nativeRefs, nativeMessageRef, pendingNavigationRef,
        navigationErrorRef, navigationTimeoutRef, activeTabIdRef,
        iframeRefs: ref(new Map()), softNavigationFallbackRef: ref(new Map()), navigationFallbackRef: ref(new Map()), readyTabIdsRef: ref(new Set()),
        WORKSPACE_TAB_MESSAGE_SOURCE: "workspace-test",
        normalizeWorkspaceUrl: (url: string) => url,
        markTabFrameReady: () => { contentAcknowledgements++ },
        reportInitialPanelReady() {}, setRouteLoadingTabId() {}, saveTabsState() {}, setTabContextStatus() {}, setTabContextOpen() {},
        titleForUrl: () => "Relationships", routeCanShowRelationshipContext: () => false,
        setNavigationStateByTab: (update: (state: typeof navigationState) => typeof navigationState) => { navigationState = update(navigationState) },
        setTabs: (update: (tabs: Tab[]) => Tab[]) => { tabsRef.current = update(tabsRef.current) },
        postToTab: (id: string, message: Parameters<Handle["post"]>[0]) => { nativeRefs.current.get(id)?.post(message) },
    }
    function render(url = tab.url) {
        tab = { ...tab, url, history: [url], historyIndex: 0 }
        tabsRef.current = [tab]
        pendingNavigationRef.current.set(tabId, url)
        navigationState = { [tabId]: { status: "loading", requestedUrl: url } }
        const hostContext = { ...shared, ...hooks(0, downgrade === "host") }
        const completeTabNavigation = evaluate(declarations(hostSource, ["completeTabNavigation"]), hostContext, "completeTabNavigation")
        evaluate(effectSource(hostSource, "function receiveFrameMessage"), { ...hostContext, completeTabNavigation })
        const nativeContext = {
            ...shared, ...hooks(1, downgrade === "native"), tab, active: true, accountCleared: false, current, committedUrl,
            blockedByAccess: false, refresh() {},
            assignRef: (id: string, handle: Handle | null) => { if (handle) nativeRefs.current.set(id, handle); else nativeRefs.current.delete(id) },
            post: (message: { type: string; url: string }) => nativeMessageRef.current({ source: "workspace-test", target: "host", tabId, ...message }),
        }
        const callbacks = evaluate(declarations(nativeSource, ["reportLocation", "onMounted"]), nativeContext, "({reportLocation, onMounted})") as { reportLocation: () => void; onMounted: () => void }
        lateMounted = callbacks.onMounted
        evaluate(effectSource(nativeSource, "current.current = { tab, active, accountCleared }"), { ...nativeContext, ...hooks(1) })
        evaluate(effectSource(nativeSource, "committedUrl.current = null"), { ...nativeContext, ...hooks(1) })
        evaluate(effectSource(nativeSource, "assignRef(tab.id"), { ...nativeContext, ...callbacks })
        const ready = nodesMatching(nativeSource, (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "Ready")
        assert.equal(ready.length, 1)
        const Ready = evaluate(ready[0].getText(nativeSource), {
            ...hooks(2), window, document, afterVisibleWorkspacePaint,
            requestAnimationFrame: () => { throw new Error("Hidden paint requested") }, cancelAnimationFrame() {},
        }, "Ready") as (props: { onMounted: () => void; onReady: () => void }) => void
        Ready({ onMounted: callbacks.onMounted, onReady: () => { paintAcknowledgements++ } })
        // Update/StrictMode replay tears down the old registrations first.
        for (const cleanup of cleanups) cleanup()
        cleanups = []
        for (const phase of ["layout", "passive"] as const) {
            for (const effect of effects.filter((effect) => effect.phase === phase).sort((left, right) => right.depth - left.depth)) {
                const cleanup = effect.create()
                if (cleanup) cleanups.push(cleanup)
            }
        }
        effects = []
    }
    return {
        render,
        state: () => ({ navigationState, pending: pendingNavigationRef.current.get(tabId), contentAcknowledgements, paintAcknowledgements, committedUrl: committedUrl.current }),
        lateMounted: () => lateMounted,
        unmount: () => { for (const cleanup of cleanups) cleanup(); cleanups = [] },
    }
}

test("hidden cached native mount clears functional loading before any paint", () => {
    const fixture = handshakeFixture()
    fixture.render()
    assert.deepEqual(fixture.state().navigationState, {})
    assert.equal(fixture.state().pending, undefined)
    assert.equal(fixture.state().contentAcknowledgements, 1)
    assert.equal(fixture.state().paintAcknowledgements, 0)
    fixture.unmount()
})

test("each old passive registration independently reproduces the lost readiness acknowledgement", () => {
    for (const oldRegistration of ["host", "native"] as const) {
        const fixture = handshakeFixture(oldRegistration)
        fixture.render()
        assert.equal(fixture.state().contentAcknowledgements, 0, `${oldRegistration} receiver is not ready for the child's passive effect`)
        assert.equal(Object.values(fixture.state().navigationState)[0].status, "loading")
        assert.equal(fixture.state().paintAcknowledgements, 0)
        fixture.unmount()
    }
})

test("hidden cached query changes and setup replay acknowledge only the current route", () => {
    const fixture = handshakeFixture()
    fixture.render()
    const oldReady = fixture.lateMounted()
    fixture.render("/example/relationships?phase=retention")
    assert.deepEqual(fixture.state().navigationState, {})
    assert.equal(fixture.state().contentAcknowledgements, 2)
    oldReady()
    assert.equal(fixture.state().contentAcknowledgements, 2, "a superseded render cannot claim the new URL")
    fixture.render("/example/relationships?phase=retention")
    assert.deepEqual(fixture.state().navigationState, {})
    assert.equal(fixture.state().contentAcknowledgements, 3, "cleanup/setup replay restores both receivers")
    assert.equal(fixture.state().paintAcknowledgements, 0)
    const afterUnmount = fixture.lateMounted()
    fixture.unmount()
    afterUnmount()
    assert.equal(fixture.state().contentAcknowledgements, 3)
})
