import assert from "node:assert/strict"
import test from "node:test"
import {
    appendWorkspaceTabHistory,
    normalizeWorkspaceUrl,
    WORKSPACE_TAB_FRAME_PARAM,
    workspaceTabFrameUrl,
    workspaceTabHistoryStep,
} from "../lib/workspace-tabs.ts"

const origin = "https://dashboard.betelgeze.com"

test("normalizes rewritten workspace routes without leaking the frame marker", () => {
    const url = normalizeWorkspaceUrl(
        `/admin/client/client-1?filter=active&${WORKSPACE_TAB_FRAME_PARAM}=tab-1#messages`,
        "scaylup",
        origin
    )

    assert.equal(url, "/scaylup/clients/client-1?filter=active#messages")
})

test("normalizes dashboard and leadgen routes to the public workspace URL", () => {
    assert.equal(
        normalizeWorkspaceUrl("/dashboard/scaylup/relationships?sort=newest", "scaylup", origin),
        "/scaylup/relationships?sort=newest"
    )
    assert.equal(
        normalizeWorkspaceUrl("/leadgen/scaylup/polls/poll-1", "scaylup", origin),
        "/scaylup/leadgen/polls/poll-1"
    )
})

test("adds a tab identity while preserving filters and hash navigation", () => {
    assert.equal(
        workspaceTabFrameUrl("/scaylup/settings?section=sources#owner-phone", "tab-2", origin),
        `/scaylup/settings?section=sources&${WORKSPACE_TAB_FRAME_PARAM}=tab-2#owner-phone`
    )
})

test("tab history cannot move before its creation page or past its newest page", () => {
    const history = ["/scaylup", "/scaylup/clients/client-1"]

    assert.equal(workspaceTabHistoryStep(history, 0, -1), null)
    assert.deepEqual(workspaceTabHistoryStep(history, 1, -1), { historyIndex: 0, url: "/scaylup" })
    assert.deepEqual(workspaceTabHistoryStep(history, 0, 1), { historyIndex: 1, url: "/scaylup/clients/client-1" })
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
