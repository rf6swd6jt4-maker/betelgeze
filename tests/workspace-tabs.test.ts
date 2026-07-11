import assert from "node:assert/strict"
import test from "node:test"
import {
    appendWorkspaceTabHistory,
    isReopenClosedTabShortcut,
    normalizeWorkspaceUrl,
    reorderWorkspaceTabs,
    WORKSPACE_TAB_FRAME_PARAM,
    workspaceTabFrameUrl,
    workspaceTabHistoryStep,
    workspaceRouteCanShowRelationshipContext,
} from "../lib/workspace-tabs.ts"

const origin = "https://dashboard.betelgeze.com"

test("normalizes rewritten workspace routes without leaking the frame marker", () => {
    const url = normalizeWorkspaceUrl(
        `/dashboard/scaylup/relationships/client-1?filter=active&${WORKSPACE_TAB_FRAME_PARAM}=tab-1#messages`,
        "scaylup",
        origin
    )

    assert.equal(url, "/scaylup/relationships/client-1?filter=active#messages")
})

test("normalizes dashboard routes to the public workspace URL", () => {
    assert.equal(
        normalizeWorkspaceUrl("/dashboard/scaylup/relationships?sort=newest", "scaylup", origin),
        "/scaylup/relationships?sort=newest"
    )
})

test("adds a tab identity while preserving filters and hash navigation", () => {
    assert.equal(
        workspaceTabFrameUrl("/scaylup/settings?section=sources#owner-phone", "tab-2", origin),
        `/scaylup/settings?section=sources&${WORKSPACE_TAB_FRAME_PARAM}=tab-2#owner-phone`
    )
})

test("workspace shell only supports relationship context on detail routes", () => {
    assert.equal(workspaceRouteCanShowRelationshipContext("/scaylup/relationships/client-1", "scaylup", origin), true)
    assert.equal(workspaceRouteCanShowRelationshipContext("/scaylup/onboarding/client-1", "scaylup", origin), true)
    assert.equal(workspaceRouteCanShowRelationshipContext("/scaylup/work/client-1", "scaylup", origin), true)
    assert.equal(workspaceRouteCanShowRelationshipContext("/scaylup/onboarding", "scaylup", origin), false)
    assert.equal(workspaceRouteCanShowRelationshipContext("/scaylup/relationships", "scaylup", origin), false)
})

test("tab history cannot move before its creation page or past its newest page", () => {
    const history = ["/scaylup", "/scaylup/relationships/client-1"]

    assert.equal(workspaceTabHistoryStep(history, 0, -1), null)
    assert.deepEqual(workspaceTabHistoryStep(history, 1, -1), { historyIndex: 0, url: "/scaylup" })
    assert.deepEqual(workspaceTabHistoryStep(history, 0, 1), { historyIndex: 1, url: "/scaylup/relationships/client-1" })
    assert.equal(workspaceTabHistoryStep(history, 1, 1), null)
})

test("bounded tab history permanently keeps the page where the tab was created", () => {
    const history = Array.from({ length: 50 }, (_, index) => index === 0 ? "/created-here" : `/page-${index}`)
    const next = appendWorkspaceTabHistory(history, 49, "/page-50", 50)

    assert.equal(next.history.length, 50)
    assert.equal(next.history[0], "/created-here")
    assert.equal(next.history[49], "/page-50")
    assert.equal(next.historyIndex, 49)
})

test("recognizes the reopen-closed-tab shortcut on macOS and Windows", () => {
    assert.equal(isReopenClosedTabShortcut({ key: "T", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }), true)
    assert.equal(isReopenClosedTabShortcut({ key: "t", metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }), true)
    assert.equal(isReopenClosedTabShortcut({ key: "t", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }), false)
    assert.equal(isReopenClosedTabShortcut({ key: "t", metaKey: false, ctrlKey: true, shiftKey: true, altKey: true }), false)
})

test("reorders tabs by insertion point without changing their identity", () => {
    const tabs = [{ id: "one" }, { id: "two" }, { id: "three" }]

    assert.deepEqual(reorderWorkspaceTabs(tabs, "one", 2).map((tab) => tab.id), ["two", "three", "one"])
    assert.deepEqual(reorderWorkspaceTabs(tabs, "three", 0).map((tab) => tab.id), ["three", "one", "two"])
    assert.equal(reorderWorkspaceTabs(tabs, "two", 1), tabs)
})
