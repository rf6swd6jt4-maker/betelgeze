import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { WORKSPACE_FRAME_ERROR_ATTRIBUTE } from "../lib/workspace-tab-departure.ts"

function source(path: string) { return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }
function matching(root: ts.SourceFile, predicate: (node: ts.Node) => boolean) {
    const found: ts.Node[] = []
    function visit(node: ts.Node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit) }
    visit(root); assert.equal(found.length, 1)
    return found[0]
}
function evaluate(code: string, context: Record<string, unknown>, result: string) {
    const javascript = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
    return new Function(...Object.keys(context), `${javascript}; return ${result};`)(...Object.values(context))
}

test("the actual native handle resets a failed boundary on explicit Retry; ordinary refresh preserves the boundary", () => {
    const root = source("components/workspace/NativeWorkspaceTab.tsx")
    const declaration = matching(root, (node) => ts.isClassDeclaration(node) && node.name?.text === "PanelBoundary")
    class Component {
        props: { onRetry: () => void; onFailure: () => void }
        state = { failed: false }
        updates = 0
        constructor(props: Component["props"]) { this.props = props }
        setState(next: { failed: boolean }) { this.state = next; this.updates++ }
    }
    const Boundary = evaluate(declaration.getText(root), { Component }, "PanelBoundary")
    let reads = 0
    const boundary = new Boundary({ onRetry: () => { reads++ }, onFailure() {} })
    boundary.state = Boundary.getDerivedStateFromError()
    let post!: (message: { type: string; active?: boolean; refresh?: boolean }) => void
    const effect = matching(root, (node) => ts.isCallExpression(node) && node.expression.getText(root) === "useLayoutEffect" && Boolean(node.arguments[0]?.getText(root).includes("assignRef(tab.id"))) as ts.CallExpression
    const cleanup = evaluate(`const run = ${effect.arguments[0].getText(root)};`, {
        tab: { id: "tab", url: "/fixture/assets" }, owner: { current: {} }, boundary: { current: boundary }, blockedByAccess: false, committedUrl: { current: null }, reportLocation() {},
        refresh: () => { reads++ }, assignRef: (_id: string, handle: { post: typeof post } | null) => { if (handle) post = handle.post },
    }, "run()")
    post({ type: "activate", active: true, refresh: true })
    assert.equal(boundary.state.failed, true, "routine refresh does not remount/reset component owners")
    post({ type: "retry" })
    assert.equal(boundary.state.failed, false)
    assert.equal(boundary.updates, 1)
    post({ type: "retry" })
    assert.equal(boundary.updates, 1, "a read retry with usable content need not reset its owner")
    assert.equal(reads, 3)
    cleanup()
})

test("the no-page-owner error marker exists only while the committed boundary is mounted", () => {
    const root = source("components/errors/ErrorBoundaryReporter.tsx")
    const effect = matching(root, (node) => ts.isCallExpression(node) && node.expression.getText(root) === "useEffect" && Boolean(node.arguments[0]?.getText(root).includes("root.setAttribute(WORKSPACE_FRAME_ERROR_ATTRIBUTE"))) as ts.CallExpression
    const attributes = new Map()
    const cleanup = evaluate(`const run = ${effect.arguments[0].getText(root)};`, {
        WORKSPACE_FRAME_ERROR_ATTRIBUTE,
        document: { documentElement: { setAttribute: (key: string, value: string) => attributes.set(key, value), removeAttribute: (key: string) => attributes.delete(key) } },
    }, "run()")
    assert.equal(attributes.get(WORKSPACE_FRAME_ERROR_ATTRIBUTE), "true")
    cleanup()
    assert.equal(attributes.has(WORKSPACE_FRAME_ERROR_ATTRIBUTE), false)
})
