import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("the Today column opens everything through the shell's resident tab owner", () => {
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /const todayColumnVisible = useTodayColumnVisible\(layout === "today"\)/)
    assert.match(shell, /todayColumnVisible \? <div data-workspace-today-shell/, "a hidden column is not mounted, so it never fetches")
    assert.match(source("components/workspace/TodayColumn.tsx"), /WIDE_QUERY = "\(min-width: 1024px\)"/)
    assert.match(shell, /onOpen=\{\(href\) => \{ void openWorkspaceTab\(href\) \}\}/)
    assert.match(shell, /cache=\{nativeCache\}/)
    assert.match(shell, /document\.body\.dataset\.workspaceLayout = layout/)
    const column = source("components/workspace/TodayColumn.tsx")
    assert.doesNotMatch(column, /router\.push|window\.location|<a\b|href=\{/, "the column never navigates on its own")
})

test("the Today column shares the Queue panel's cache and never polls", () => {
    const column = source("components/workspace/TodayColumn.tsx")
    assert.match(column, /nativePanelCacheKey\(userId, workspaceId, queueUrl\)/)
    assert.match(column, /cache\.load\(queueKey, \(signal\) => readNativePanel\(\{ url: queueUrl/)
    assert.doesNotMatch(column, /setInterval|setTimeout\(|subscribe\(\s*["']realtime/)
    assert.match(column, /ATTENTION_REFRESH_MS = 60_000/)
    assert.match(column, /document\.visibilityState === "visible" && Date\.now\(\) - lastAttention\.current >= ATTENTION_REFRESH_MS/)
    assert.match(column, /if \(!canSeeAttention\) return/, "staff never request team-wide attention")
})

test("the frame changes only from lg up and only for the Today layout", () => {
    const css = source("app/globals.css")
    const block = css.slice(css.indexOf("@media (min-width: 1024px) {\n  [data-workspace-today-shell]"))
    assert.ok(block.length > 0)
    const lg = block.slice(0, block.indexOf("\n}\n"))
    assert.match(lg, /body\[data-workspace-layout="today"\] \[data-workspace-tabbar\] \{\s*display: none;/)
    assert.match(lg, /body\[data-workspace-layout="today"\] \[data-workspace-tab-panels\] \{\s*top: 3\.5rem;/)
    assert.match(css, /--workspace-today-width: 22rem;/)
})

test("the Needs attention route is owner/admin only, account-checked and read-only", () => {
    const route = source("app/api/workspaces/[workspaceSlug]/needs-attention/route.ts")
    assert.match(route, /requireWorkspace\(workspaceSlug, "admin"\)/)
    assert.match(route, /x-workspace-user/)
    assert.match(route, /workspace_needs_attention/)
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/)
})
