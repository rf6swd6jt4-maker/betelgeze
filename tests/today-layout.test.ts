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

test("the column frame changes only from lg up and only for the Today layout", () => {
    const css = source("app/globals.css")
    const block = css.slice(css.indexOf("@media (min-width: 1024px) {\n  [data-workspace-today-shell]"))
    assert.ok(block.length > 0)
    const lg = block.slice(0, block.indexOf("\n}\n"))
    assert.match(css, /\nbody\[data-workspace-layout="today"\] \[data-workspace-tabbar\] \[role="tablist"\] \{\s*visibility: hidden;/, "tabs go at every width")
    assert.doesNotMatch(lg, /\[data-workspace-tabbar\] \{\s*display: none/, "the strip stays, so the context-panel toggle stays")
    assert.match(lg, /body\[data-workspace-layout="today"\] \[data-workspace-tabbar\],\s*body\[data-workspace-layout="today"\] \[data-workspace-tab-panels\] \{\s*left: calc\(var\(--workspace-sidebar-width\) \+ var\(--workspace-today-width\)\)/)
    assert.match(css, /--workspace-today-width: 22rem;/)
})

test("the Needs attention route is owner/admin only, account-checked and read-only", () => {
    const route = source("app/api/workspaces/[workspaceSlug]/needs-attention/route.ts")
    assert.match(route, /requireWorkspace\(workspaceSlug, "admin"\)/)
    assert.match(route, /x-workspace-user/)
    assert.match(route, /workspace_needs_attention/)
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/)
})

test("below lg the Today column opens as a left sheet from the Today button", () => {
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /layout === "today" \? <button type="button" data-today-button/)
    assert.match(shell, /lg:hidden">Today<\/button>/)
    assert.match(shell, /layout === "today" && todaySheetOpen && !todayColumnVisible \? <SideDrawer side="left" label="Today"/, "the sheet mounts only while open and never alongside the column")
    assert.match(shell, /onOpen=\{\(href\) => \{ dismiss\(\); void openWorkspaceTab\(href\) \}\}/)
    assert.match(shell, /window\.matchMedia\("\(min-width: 1024px\)"\)\.matches\) return/, "opens by default only on narrow screens")
    const drawer = source("components/ui/SideDrawer.tsx")
    assert.match(drawer, /side = "right"/)
    assert.match(source("app/globals.css"), /\.betelgeze-drawer-left \{/)
})

test("reopening the sheet within a minute reuses Needs attention", () => {
    const column = source("components/workspace/TodayColumn.tsx")
    assert.match(column, /const attentionMemory = new Map</)
    assert.match(column, /if \(Date\.now\(\) - lastAttention\.current >= ATTENTION_REFRESH_MS\) void loadAttention\(controller\.signal\)/)
})

test("at the open-item limit the Today layout drops the least recently used unmounted destination", async () => {
    // @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
    const { workspaceTabToEvict } = await import("../lib/workspace-tabs.ts")
    const tabs = ["a", "b", "c", "d", "e", "f", "g", "h"]
    assert.equal(workspaceTabToEvict(tabs, ["h", "g", "c", "a"], ["h", "g", "c"]), "b", "never-activated destinations go first, oldest position first")
    assert.equal(workspaceTabToEvict(tabs, ["h", "g", "f", "e", "d", "c", "b", "a"], ["h", "g", "f"]), "a", "then the least recently activated")
    assert.equal(workspaceTabToEvict(tabs, ["a", "b", "c", "d", "e", "f", "g", "h"], ["h", "a", "b"]), "g", "a protected destination is skipped even when it is the oldest")
    assert.equal(workspaceTabToEvict(["a", "b"], ["a", "b"], ["a", "b"]), null, "nothing is dropped when everything is mounted")

    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /const evictTabId = layout === "today" && !alreadyOpen && openTabs\.length >= MAX_OPEN_WORKSPACE_TABS/, "the tabbed layout keeps its rule")
    assert.match(shell, /workspaceTabToEvict\(openTabs\.map\(\(tab\) => tab\.id\), tabRecencyRef\.current, \[activeTabIdRef\.current, \.\.\.residentTabIdsRef\.current\]\)/, "mounted and active destinations are protected")
    assert.match(shell, /prepareNativeLeave\(\{ activateTabId: requestedTabId, closeTabId: evictTabId \?\? undefined,/, "the drop goes through the departure check")
    assert.match(shell, /!residentTabIdsRef\.current\.includes\(evictTabId\)\s*&& !iframeRefs\.current\.has\(evictTabId\) && !nativeRefs\.current\.has\(evictTabId\)/, "re-validated inside the commit")
    assert.match(shell, /if \(!tabId \|\| evictTabId !== null\) \{ nativeNavigationPerformance\.finish\(intent, "aborted"\); return \}/, "a stale plan never navigates the active destination unchecked")
})

test("Today column wording is short and relative to the person's day", async () => {
    // @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
    const { waitingLabel, effortLabel, dueLabel } = await import("../lib/today-column.ts")
    const now = new Date(2026, 10, 15, 12, 0, 0).getTime()
    const ago = (ms: number) => new Date(now - ms).toISOString()
    assert.equal(waitingLabel(ago(40 * 60_000), now), "40m")
    assert.equal(waitingLabel(ago(26 * 3_600_000), now), "26h")
    assert.equal(waitingLabel(ago(3 * 86_400_000), now), "3d")
    assert.equal(waitingLabel(ago(35 * 86_400_000), now), "5w")
    assert.equal(waitingLabel(null, now), "")
    assert.equal(waitingLabel(ago(-60_000), now), "", "a future time is not a wait")
    assert.equal(effortLabel(45), "~45 min")
    assert.equal(effortLabel(60), "~1 h")
    assert.equal(effortLabel(150), "~2.5 h")
    assert.equal(effortLabel(null), "")
    assert.deepEqual(dueLabel(ago(-3 * 3_600_000), now), { label: "Due today", late: false })
    assert.deepEqual(dueLabel(ago(3 * 3_600_000), now), { label: "Was due today", late: true })
    assert.deepEqual(dueLabel(ago(-24 * 3_600_000), now), { label: "Due tomorrow", late: false })
    assert.deepEqual(dueLabel(ago(24 * 3_600_000), now), { label: "Due yesterday", late: true })
    assert.deepEqual(dueLabel(ago(72 * 3_600_000), now), { label: "Overdue 3d", late: true })
    assert.equal(dueLabel(null, now), null)
})

test("the Today column's rows are single activation targets and add no timers", () => {
    const column = source("components/workspace/TodayColumn.tsx")
    assert.match(column, /<ListCompactItem key=\{item\.id\} current=\{pathOf\(href\) === activePath\} onOpen=\{\(\) => onOpen\(href\)\}/)
    assert.match(column, /recent\.filter\(destination => pathOf\(destination\.url\) !== activePath\)\.slice\(0, RECENT_ROWS\)/)
    assert.doesNotMatch(column, /setInterval|setTimeout\(/)
    const list = source("components/list/List.tsx")
    assert.match(list, /export function ListCompactItem/)
    assert.match(list, /aria-current=\{current \? "page" : undefined\}/)
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /layout === "today" \? <p data-today-destination/)
    assert.match(shell, /recent=\{todayRecent\}/)
})

test("a docked chat is the active chat only while the shell names it and its frame is shown", async () => {
    // @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
    const { workspaceDocumentIsActive } = await import("../lib/workspace-tab-activity.ts")
    const previous = { window: globalThis.window, document: globalThis.document }
    const host = { document: { body: { dataset: { workspaceActiveTabId: "work" } as Record<string, string> } } }
    const frame = { hidden: false }
    const page = { parent: host, frameElement: frame, name: "betelgeze-tab:docked-chat", location: { search: "?__betelgeze_tab=docked-chat" } }
    const body = { dataset: { workspaceTabActive: "true" } as Record<string, string> }
    try {
        Object.assign(globalThis, { window: page, document: { body } })
        assert.equal(workspaceDocumentIsActive(), false, "an unnamed dock is never active, whatever its own page believes")
        host.document.body.dataset.workspaceDockedTabId = "docked-chat"
        assert.equal(workspaceDocumentIsActive(), true)
        frame.hidden = true
        assert.equal(workspaceDocumentIsActive(), false, "hidden behind Context reads nothing")
        frame.hidden = false
        host.document.body.dataset.workspaceDockedTabId = "another"
        assert.equal(workspaceDocumentIsActive(), false)
        // An ordinary destination is unaffected by a dock being named.
        Object.assign(page, { name: "betelgeze-tab:work", location: { search: "?__betelgeze_tab=work" } })
        host.document.body.dataset.workspaceDockedTabId = "docked-chat"
        assert.equal(workspaceDocumentIsActive(), true)
        Object.assign(page, { name: "betelgeze-tab:other", location: { search: "?__betelgeze_tab=other" } })
        assert.equal(workspaceDocumentIsActive(), false)
    } finally { Object.assign(globalThis, previous) }
})

test("only the dock owner names the docked chat, and only while it is displayed and ready", () => {
    const owner = source("components/workspace/DockedCommunications.tsx")
    assert.match(owner, /if \(shown && ready\) host\.workspaceDockedTabId = WORKSPACE_DOCKED_CHAT_TAB_ID/)
    assert.match(owner, /return \(\) => \{ if \(host\.workspaceDockedTabId === WORKSPACE_DOCKED_CHAT_TAB_ID\) delete host\.workspaceDockedTabId \}/)
    assert.match(owner, /hidden=\{!shown\}/)
    assert.match(owner, /prepareWorkspaceFrameDeparture\(node, WORKSPACE_DOCKED_CHAT_TAB_ID, window\) && confirmWorkspaceFrameDeparture\(node\)/)
    assert.doesNotMatch(owner, /setInterval|location\.reload/, "no polling and no automatic reload")
    const writers = ["components/workspace/WorkspaceTopBarClient.tsx", "components/workspace/ShellRelationshipContextPanel.tsx", "components/workspace/TodayColumn.tsx"]
    for (const path of writers) assert.doesNotMatch(source(path), /workspaceDockedTabId/, `${path} must not name the dock itself`)

    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /const canDockChat = layout === "today" && todayColumnVisible && canAccessWorkspacePanel\(workspacePanelByKey\("communications"\)/, "Today layout, desktop width, Communications access")
    assert.match(shell, /\{dock \? <aside data-workspace-docked-chat=/, "nothing is mounted until a dock is asked for")
    assert.match(shell, /const safe = await \(dockHandleRef\.current\?\.leave\(\) \?\? true\)/)
    assert.match(shell, /if \(!safe\) \{ setDockNotice\(/, "a chat that cannot confirm stays mounted")
    assert.match(source("components/workspace/ShellRelationshipContextPanel.tsx"), /<ContextContent \{\.\.\.props\} onChat=\{undefined\} onClose=\{dismiss\}/, "the phone context drawer never offers the dock")
})
