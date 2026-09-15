import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync, existsSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"
import { WORKSPACE_PANELS } from "../lib/workspace-panels.ts"
import { workspaceRouteIsRecordDetail } from "../lib/workspace-tabs.ts"

const path = "components/workspace/WorkspaceTabOpeningState.tsx"
const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "panelLoadingForUrl")!
const loadingFor = new Function("workspaceRouteIsRecordDetail", ts.transpileModule(`${fn.getText(ast)}; return panelLoadingForUrl`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText)(workspaceRouteIsRecordDetail)

test("every shell navigation panel has a specific skeleton rather than a record or startup fallback", () => {
    for (const panel of WORKSPACE_PANELS) {
        if ("standalone" in panel && panel.standalone) continue
        for (const route of [panel.route, ...("activeRoutes" in panel ? panel.activeRoutes : [])]) {
            assert.notEqual(loadingFor(`/fixture/${route}`, "fixture").variant, "detail", route)
            assert.ok(existsSync(`app/[workspaceSlug]/${route}/loading.tsx`), route)
        }
    }
    assert.equal(loadingFor("/fixture/queue", "fixture").variant, "queue")
    assert.equal(loadingFor("/fixture/sops", "fixture").variant, "sops")
    assert.equal(loadingFor("/fixture/sops/11111111-1111-4111-8111-111111111111", "fixture").variant, "detail")
})
const loaded = new Map<string, unknown>()
function load(path: string): Record<string, React.ComponentType<Record<string, unknown>>> {
    const full = resolve(path)
    if (loaded.has(full)) return loaded.get(full) as ReturnType<typeof load>
    const require = createRequire(full)
    const compiled = new Module(full) as Module & { _compile: (source: string, filename: string) => void }
    compiled.require = ((name: string) => {
        if (name === "@/components/workspace/WorkspaceLink") return { default: "a" }
        if (name === "@/components/workspace/DetailRouteLoading") return { DetailRouteLoading: () => null }
        if (name === "@/lib/workspace-detail-preview") return { serializeWorkspaceDetailPreview: () => "" }
        if (name === "next/navigation") return { usePathname: () => `/onboarding/session/${"a".repeat(64)}` }
        if (name.startsWith("@/")) return load(name.slice(2) + ".tsx")
        return require(name)
    }) as typeof compiled.require
    compiled._compile(ts.transpileModule(readFileSync(full, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, full)
    loaded.set(full, compiled.exports)
    return compiled.exports
}
test("queue and SOP skeletons render their panel structures, with no banner or BE mark", () => {
    const { PanelRouteLoading } = load("components/workspace/PanelRouteLoading.tsx")
    for (const [variant, title, rows] of [["queue", "Work Queue", 5], ["sops", "SOPs", 4]] as const) {
        const html = renderToStaticMarkup(React.createElement(PanelRouteLoading, { variant }))
        assert.ok(html.includes(`aria-label="Loading ${title}"`))
        assert.equal((html.match(/role="listitem"/g) ?? []).length, rows)
        assert.doesNotMatch(html, /data-app-startup-screen|data-workspace-shared-banner|viewBox="0 0 64 64"/)
    }
})
test("public onboarding starts the agency logo request in its first fallback HTML", () => {
    const { OnboardingStartupScreen } = load("components/onboarding/OnboardingStartupScreen.tsx")
    const html = renderToStaticMarkup(React.createElement(OnboardingStartupScreen))
    assert.ok(html.includes(`/api/client-branding/logo/onboarding/${"a".repeat(64)}`))
    assert.doesNotMatch(html, /Betelgeze|diamond|data-app-startup-screen/)
})
