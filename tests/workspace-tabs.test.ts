import assert from "node:assert/strict"
import test from "node:test"
import {
    normalizeWorkspaceUrl,
    WORKSPACE_TAB_FRAME_PARAM,
    workspaceTabFrameUrl,
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
