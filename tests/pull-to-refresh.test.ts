import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import {
    beginPullToRefreshGesture,
    PULL_TO_REFRESH_THRESHOLD,
    shouldRefreshFromPull,
    updatePullToRefreshGesture,
} from "../lib/pull-to-refresh.ts"

test("pull to refresh arms only after a deliberate downward gesture", () => {
    const start = beginPullToRefreshGesture(20, 20)
    const short = updatePullToRefreshGesture(start, 22, 20 + PULL_TO_REFRESH_THRESHOLD)
    const armed = updatePullToRefreshGesture(start, 22, 20 + Math.ceil(PULL_TO_REFRESH_THRESHOLD / 0.55))
    assert.equal(shouldRefreshFromPull(short), false)
    assert.equal(shouldRefreshFromPull(armed), true)
})

test("horizontal, upward, and cancelled gestures never refresh", () => {
    const start = beginPullToRefreshGesture(20, 20)
    const horizontal = updatePullToRefreshGesture(start, 80, 28)
    const upward = updatePullToRefreshGesture(start, 20, 10)
    assert.equal(horizontal.cancelled, true)
    assert.equal(upward.cancelled, true)
    assert.equal(shouldRefreshFromPull(updatePullToRefreshGesture(horizontal, 80, 200)), false)
})

test("mobile shell uses pull refresh while retaining the desktop reload control", async () => {
    const shell = await readFile(new URL("../components/workspace/WorkspaceTopBarClient.tsx", import.meta.url), "utf8")
    const mobileSidebar = shell.slice(shell.indexOf("<aside data-workspace-sidebar"))
    assert.doesNotMatch(mobileSidebar, /aria-label="Reload workspace"/)
    assert.match(shell.slice(0, shell.indexOf("<aside data-workspace-sidebar")), /aria-label="Reload workspace"/)
})

test("pull refresh preserves native overscroll and covers only the refreshing tab", async () => {
    const component = await readFile(new URL("../components/workspace/PullToRefresh.tsx", import.meta.url), "utf8")
    assert.match(component, /addEventListener\("touchmove", move, \{ passive: true \}\)/)
    assert.doesNotMatch(component, /preventDefault/)
    assert.match(component, /!active \|\| !refreshing/)
    assert.match(component, /place-items-center bg-black/)
    assert.match(component, /aria-label="Refreshing tab"/)
})
