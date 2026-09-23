import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { createWorkspaceFrameNavigator, WorkspaceFrameDraftError, workspaceFrameHasNavigationReceiver } from "../lib/workspace-frame-navigation.ts"

function deferred() {
    let resolve!: (value: boolean) => void
    const promise = new Promise<boolean>((done) => { resolve = done })
    return { promise, resolve }
}
function fixture(flush: () => Promise<unknown> = async () => true) {
    let current = "/fixture/queue"
    const pushes: string[] = []
    const replacements: string[] = []
    const navigator = createWorkspaceFrameNavigator({ currentUrl: () => current, flush, push: (url) => pushes.push(url), replace: (url) => replacements.push(url) })
    return { navigator, pushes, replacements, commit(url: string) { current = url; navigator.committed(url) } }
}
test("returning to A while B is streaming cancels B through the resident router", async () => {
    const f = fixture()
    await f.navigator.navigate("/fixture/appointment-setting")
    await f.navigator.navigate("/fixture/queue")
    assert.deepEqual(f.pushes, ["/fixture/appointment-setting", "/fixture/queue"])
    f.commit("/fixture/queue")
    await f.navigator.navigate("/fixture/queue")
    assert.equal(f.pushes.length, 2, "resident same-route activation is free")
})
test("a slow earlier draft flush cannot navigate after the latest destination", async () => {
    const first = deferred(), second = deferred()
    let count = 0
    const f = fixture(() => ++count === 1 ? first.promise : second.promise)
    const old = f.navigator.navigate("/fixture/appointment-setting")
    const latest = f.navigator.navigate("/fixture/queue")
    second.resolve(true)
    await latest
    first.resolve(true)
    await old
    assert.deepEqual(f.pushes, ["/fixture/queue"])
})
test("repeated pending clicks do not flush or fetch twice", async () => {
    const flush = deferred()
    let count = 0
    const f = fixture(() => { count++; return flush.promise })
    const pending = f.navigator.navigate("/fixture/sops")
    await f.navigator.navigate("/fixture/sops")
    assert.equal(count, 1)
    flush.resolve(true)
    await pending
    assert.deepEqual(f.pushes, ["/fixture/sops"])
})
test("failed draft persistence prevents navigation and allows an explicit retry", async () => {
    let safe = false
    const f = fixture(async () => safe)
    await assert.rejects(f.navigator.navigate("/fixture/sops"), WorkspaceFrameDraftError)
    assert.deepEqual(f.pushes, [])
    safe = true
    await f.navigator.navigate("/fixture/sops", true)
    assert.deepEqual(f.replacements, ["/fixture/sops"])
})
test("a router failure is not reported as failed draft persistence", async () => {
    const failure = new Error("Router unavailable")
    const navigator = createWorkspaceFrameNavigator({ currentUrl: () => "/fixture/queue", flush: async () => true, push: () => { throw failure }, replace() {} })
    await assert.rejects(navigator.navigate("/fixture/sops"), (error) => error === failure && !(error instanceof WorkspaceFrameDraftError))
})
test("unmounted receiver cannot finish an old navigation", async () => {
    const flush = deferred()
    const f = fixture(() => flush.promise)
    const pending = f.navigator.navigate("/fixture/sops")
    f.navigator.dispose()
    flush.resolve(true)
    await pending
    assert.deepEqual(f.pushes, [])
})
test("host routes rapid switches through the live receiver even before destination readiness", () => {
    const path = "components/workspace/WorkspaceTopBarClient.tsx"
    const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let callback = ""
    function visit(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "requestTabFrameNavigation") callback = (node.initializer as ts.CallExpression).arguments[0].getText(ast)
        ts.forEachChild(node, visit)
    }
    visit(ast)
    assert.ok(callback)
    const document = { documentElement: { getAttribute: () => "tab" } } as unknown as Document
    const messages: unknown[] = [], hard: unknown[] = []
    const refs = { nativeRefs: { current: new Map() }, iframeRefs: { current: new Map([["tab", { contentDocument: document }]]) }, readyTabIdsRef: { current: new Set() }, postToTab: (...args: unknown[]) => { messages.push(args); return true }, ensureTabFrameLocation: (...args: unknown[]) => hard.push(args), scheduleSoftNavigationFallback: () => {}, workspaceFrameHasNavigationReceiver }
    const navigate = new Function(...Object.keys(refs), ts.transpileModule(`return (${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText)(...Object.values(refs))
    navigate("tab", "/fixture/appointment-setting")
    navigate("tab", "/fixture/queue")
    assert.equal(messages.length, 2)
    assert.equal(hard.length, 0, "pending readiness cannot trigger document reload")
    refs.iframeRefs.current.set("tab", { contentDocument: { documentElement: { getAttribute: () => null } } as unknown as Document })
    navigate("tab", "/fixture/sops")
    assert.equal(hard.length, 1, "a genuinely new document retains initial navigation fallback")
})
