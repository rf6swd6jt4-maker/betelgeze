import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { normalizeWorkspaceUrl, workspaceTabIdFromUrl, workspaceTabFrameUrl } from "../lib/workspace-tabs.ts"
import { workspaceRouteUsesShell } from "../lib/workspace-shell.ts"

const path = "components/workspace/WorkspaceTopBar.tsx"
const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function initialUrl(currentPath: string | null, supplied?: string) {
    let expression = ""
    function visit(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === "initialUrl") expression = node.initializer!.getText(source)
        ts.forEachChild(node, visit)
    }
    visit(source)
    assert.ok(expression)
    const javascript = ts.transpileModule(`return (${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText
    return new Function("initialWorkspaceUrl", "currentPath", "workspace", "normalizeWorkspaceUrl", javascript)(supplied, currentPath, { slug: "fixture" }, normalizeWorkspaceUrl) as string
}

test("cold queue entry stays at queue and has a single shell owner", () => {
    const destination = "/fixture/queue"
    assert.equal(workspaceRouteUsesShell(destination), true, "Proxy must select the persistent shell at the landing page")
    const tab = initialUrl(destination)
    assert.equal(tab, destination, "fallback must not start a root-redirect frame")
    const frame = workspaceTabFrameUrl(tab, "cold-tab", "https://app.betelgeze.com")
    assert.equal(workspaceTabIdFromUrl(frame), "cold-tab", "framed destination renders the bridge instead of another shell")
    assert.equal(normalizeWorkspaceUrl(frame, "fixture", "https://app.betelgeze.com"), destination)
})

test("cold SOP entry and saved queue launch both select the persistent shell", () => {
    for (const destination of ["/fixture/queue", "/fixture/sops", "/fixture/sops/record-id"]) {
        assert.equal(workspaceRouteUsesShell(destination), true)
    }
})

test("fallback shell starts at the actual page including its query, not the workspace root", () => {
    assert.equal(initialUrl("/fixture/queue"), "/fixture/queue")
    assert.equal(initialUrl("/fixture/sops?status=active"), "/fixture/sops?status=active")
    assert.equal(initialUrl("/fixture/admin/okrs?view=all#goal"), "/fixture/admin/okrs?view=all#goal")
    assert.equal(initialUrl("/fixture/queue", "/fixture/relationships"), "/fixture/relationships", "authorized bootstrap destination remains authoritative")
})
