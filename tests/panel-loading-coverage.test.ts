import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync, existsSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"
import { WORKSPACE_PANELS } from "../lib/workspace-panels.ts"
import { workspaceRouteUsesSharedBanner } from "../lib/workspace-panel-chrome.ts"
import { workspaceRouteIsRecordDetail } from "../lib/workspace-tabs.ts"

const openingPath = "components/workspace/WorkspaceTabOpeningState.tsx"
const openingAst = ts.createSourceFile(openingPath, readFileSync(openingPath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const mapping = openingAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "panelLoadingForUrl")!
const loadingFor = new Function("workspaceRouteIsRecordDetail", ts.transpileModule(mapping.getText(openingAst) + "; return panelLoadingForUrl", { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText)(workspaceRouteIsRecordDetail) as (url: string, slug: string) => { variant: string }

let search = new URLSearchParams()
const loaded = new Map<string, Record<string, React.ComponentType<Record<string, unknown>>>>()
function load(path: string): Record<string, React.ComponentType<Record<string, unknown>>> {
    const full = resolve(path)
    const cached = loaded.get(full)
    if (cached) return cached
    const require = createRequire(full)
    const compiled = new Module(full) as Module & { _compile: (source: string, filename: string) => void }
    compiled.require = ((name: string) => {
        if (name === "@/components/workspace/WorkspaceLink") return { default: "a" }
        if (name === "@/lib/workspace-panel-chrome") return { workspaceRouteUsesSharedBanner }
        if (name === "@/components/workspace/WorkspaceNavigation" || name === "./WorkspaceNavigation") return { usePathname: () => "/fixture", useSearchParams: () => search, useWorkspaceNavigation: () => null }
        if (name === "@/components/workspace/DetailRouteLoading") return { DetailRouteLoading: ({ title }: { title: string }) => React.createElement("main", { "data-workspace-loading-root": "", "aria-label": "Opening " + title, "aria-busy": "true" }) }
        if (name === "@/lib/workspace-detail-preview") return { serializeWorkspaceDetailPreview: () => "" }
        if (name === "@/lib/workspace-tabs") return { workspaceRouteIsRecordDetail }
        if (name === "next/navigation") return { usePathname: () => "/onboarding/session/" + "a".repeat(64), useSearchParams: () => search }
        if (name.startsWith("@/")) return load(name.slice(2) + ".tsx")
        return require(name)
    }) as typeof compiled.require
    compiled._compile(ts.transpileModule(readFileSync(full, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, full)
    const exports = compiled.exports as ReturnType<typeof load>
    loaded.set(full, exports)
    return exports
}
function html(component: React.ComponentType<Record<string, unknown>>, props: Record<string, unknown> = {}) {
    return renderToStaticMarkup(React.createElement(component, props))
}
function assertInert(markup: string, label: string) {
    assert.match(markup, /data-workspace-loading-root/)
    assert.match(markup, /aria-busy="true"/)
    assert.doesNotMatch(markup, /<(?:a|button)\b|\bhref=|\bprefetch=|\b(?:onClick|onclick)=/, label)
    assert.doesNotMatch(markup, /data-app-startup-screen|data-workspace-shared-banner|viewBox="0 0 64 64"|Betelgeze/, label)
    assert.ok(markup.length < 60_000, label + " should stay bounded")
}

test("registered panel routes and shell openings agree and remain inert", () => {
    const { WorkspaceTabOpeningState } = load(openingPath)
    for (const panel of WORKSPACE_PANELS) {
        if ("standalone" in panel && panel.standalone) continue
        for (const route of [panel.route, ...("activeRoutes" in panel ? panel.activeRoutes : [])]) {
            const routePath = "app/[workspaceSlug]/" + route + "/loading.tsx"
            assert.ok(existsSync(routePath), routePath)
            assert.notEqual(loadingFor("/fixture/" + route, "fixture").variant, "detail", route)
            const routeHtml = html(load(routePath).default)
            const shellHtml = html(WorkspaceTabOpeningState, { url: "/fixture/" + route, workspaceSlug: "fixture" })
            const label = routeHtml.match(/aria-label="Loading [^"]+"/)?.[0]
            assert.ok(label && shellHtml.includes(label), route)
            assertInert(routeHtml, route + " route")
            assertInert(shellHtml, route + " shell")
        }
    }
})

test("nested and query-sensitive destinations agree across route and shell", () => {
    const { WorkspaceTabOpeningState } = load(openingPath)
    const cases = [
        ["admin/activity", "admin-activity"], ["admin/maintenance", "admin-maintenance"], ["admin/okrs", "admin-okrs"],
        ["leadgen/polls", "leadgen-polls"], ["admin?view=okrs", "admin-okrs"], ["communications?mode=team", "communications-team"],
    ] as const
    for (const [url, variant] of cases) {
        const [route, query = ""] = url.split("?")
        search = new URLSearchParams(query)
        assert.equal(loadingFor("/fixture/" + url, "fixture").variant, variant)
        const routeHtml = html(load("app/[workspaceSlug]/" + route + "/loading.tsx").default)
        const shellHtml = html(WorkspaceTabOpeningState, { url: "/fixture/" + url, workspaceSlug: "fixture" })
        const label = routeHtml.match(/aria-label="Loading [^"]+"/)?.[0]
        assert.ok(label && shellHtml.includes(label), url)
        assertInert(routeHtml, url)
        assertInert(shellHtml, url)
    }
    search = new URLSearchParams()
})

test("Library loading shows neutral tab shapes without presumed access", () => {
    const { PanelRouteLoading } = load("components/workspace/PanelRouteLoading.tsx")
    const { PanelLoadingTabs } = load("components/panel/PanelLoading.tsx")
    for (const [variant, active] of [["work-items", 0], ["sops", 1], ["assets", 2], ["notes", 3]] as const) {
        const markup = html(PanelRouteLoading, { variant })
        const tabs = html(PanelLoadingTabs, { active })
        assertInert(markup, variant)
        assert.ok(markup.includes(tabs), variant + " should reserve the shared Library tab geometry")
        assert.match(tabs, /aria-hidden="true"/, variant)
        assert.doesNotMatch(tabs, /Work Items|Assets|Notes|SOPs|<nav|<a|<button/, variant)
        assert.doesNotMatch(tabs, /bg-white|text-black|hover:/, variant + " must not look ready or interactive")
    }
})

test("record openings identify the same destination in route and shell", () => {
    const { WorkspaceTabOpeningState } = load(openingPath)
    for (const route of [
        "relationships/[relationshipId]", "assets/[id]", "notes/[id]", "work-items/[id]",
        "onboarding/[relationshipId]", "work/[relationshipId]", "admin/okrs/[okrId]",
        "admin/activity/[eventId]",
    ]) {
        const url = "/fixture/" + route.replace(/\[[^\]]+\]/g, "example-id")
        assert.equal(loadingFor(url, "fixture").variant, "detail", route)
        const routeHtml = html(load("app/[workspaceSlug]/" + route + "/loading.tsx").default)
        const shellHtml = html(WorkspaceTabOpeningState, { url, workspaceSlug: "fixture" })
        const label = routeHtml.match(/aria-label="Opening [^"]+"/)?.[0]
        assert.ok(label && shellHtml.includes(label), route)
        assertInert(routeHtml, route)
        assertInert(shellHtml, route)
    }
})

test("retired appointment detail redirect keeps the client-connections fallback", () => {
    const route = "app/[workspaceSlug]/appointment-setting/[relationshipId]/loading.tsx"
    const url = "/fixture/appointment-setting/example-id"
    assert.equal(loadingFor(url, "fixture").variant, "client-connections")
    const { WorkspaceTabOpeningState } = load(openingPath)
    const routeHtml = html(load(route).default)
    const shellHtml = html(WorkspaceTabOpeningState, { url, workspaceSlug: "fixture" })
    assert.match(routeHtml, /aria-label="Loading Client Connections"/)
    assert.match(shellHtml, /aria-label="Loading Client Connections"/)
    assertInert(routeHtml, route)
    assertInert(shellHtml, route)
})

test("representative placeholders are bounded and respect reduced motion", () => {
    const { PanelRouteLoading } = load("components/workspace/PanelRouteLoading.tsx")
    for (const [variant, rows] of [["queue", 5], ["sops", 4], ["onboarding", 5], ["assets", 0]] as const) {
        const markup = html(PanelRouteLoading, { variant })
        assertInert(markup, variant)
        assert.equal((markup.match(/role="listitem"/g) ?? []).length, rows, variant)
        assert.doesNotMatch(markup, /(?<!motion-safe:)animate-pulse/, variant)
    }
    assert.match(html(PanelRouteLoading, { variant: "assets" }), /aria-label="Loading assets"/)
    assert.match(html(PanelRouteLoading, { variant: "queue" }), /Work Queue/)
})

test("route onboarding and activity contain the exact shared deferred placeholders", () => {
    const shared = load("components/panel/PanelLoading.tsx")
    const { PanelRouteLoading } = load("components/workspace/PanelRouteLoading.tsx")
    const onboarding = html(shared.OnboardingPanelLoading)
    const activity = html(shared.ActivityTrendsLoading)
    assert.match(onboarding, /aria-label="Loading onboarding"/)
    assert.match(activity, /aria-label="Loading activity trends"/)
    assert.ok(html(PanelRouteLoading, { variant: "onboarding" }).includes(onboarding))
    assert.ok(html(PanelRouteLoading, { variant: "admin-activity" }).includes(activity))
})

test("public onboarding requests the agency logo in its first fallback HTML", () => {
    const { OnboardingStartupScreen } = load("components/onboarding/OnboardingStartupScreen.tsx")
    const markup = html(OnboardingStartupScreen)
    assert.ok(markup.includes("/api/client-branding/logo/onboarding/" + "a".repeat(64)))
    assert.doesNotMatch(markup, /Betelgeze|diamond|data-app-startup-screen/)
})


test("shell opening chrome follows the destination rather than the current framework path", () => {
    const { WorkspacePanelChrome } = load("components/workspace/WorkspacePanelChrome.tsx")
    const banner = React.createElement("div", { "data-fixture-banner": "" }, "Workspace identity")
    for (const pathname of ["/fixture/assets", "/fixture/onboarding", "/fixture/admin/maintenance"]) {
        const markup = html(WorkspacePanelChrome, { pathname, banner, children: "Pending content" })
        assert.equal((markup.match(/data-workspace-shared-banner/g) ?? []).length, 1)
        assert.ok(markup.indexOf("Workspace identity") < markup.indexOf("Pending content"))
    }
    for (const pathname of ["/fixture/communications", "/fixture/settings", "/fixture/assets/asset-id"]) {
        assert.doesNotMatch(html(WorkspacePanelChrome, { pathname, banner, children: "Pending content" }), /data-workspace-shared-banner/)
    }
    assert.doesNotMatch(html(load("components/admin/WorkspaceBannerPending.tsx").WorkspaceBannerPending), /(?<!motion-safe:)animate-pulse/)
})
