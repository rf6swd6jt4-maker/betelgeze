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
    assert.match(css, /\n  body\[data-workspace-layout="today"\] \[data-workspace-tabbar\] \{\s*display: none;/, "from lg up the emptied strip is removed")
    assert.match(css, /body\[data-workspace-layout="today"\] \[data-workspace-tab-panels\] \{\s*top: 3\.5rem;/, "and its height goes to the work area")
    assert.match(css, /body\[data-workspace-layout="today"\] \[data-workspace-context-column\] \{\s*top: 5rem;\s*height: calc\(100dvh - 6\.5rem\);/)
    assert.match(source("components/workspace/WorkspaceTopBarClient.tsx"), /layout === "today" \? <button data-icon-button data-today-context-toggle type="button" onClick=\{toggleContextPanel\}/, "the context toggle moves to the top bar")
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

test("the Team queue is owner/admin only, read on demand, and merged fairly", async () => {
    const route = source("app/api/workspaces/[workspaceSlug]/team-queue/route.ts")
    assert.match(route, /requireWorkspace\(workspaceSlug, "admin"\)/)
    assert.match(route, /x-workspace-user/)
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/)
    const sql = source("supabase/migrations/20261115190000_team_work_queue.sql")
    assert.match(sql, /m\.role in \('owner', 'admin'\)/)
    assert.match(sql, /public\.read_personal_work_queue\(p_workspace, member\.user_id, 0, 'ready'\)/, "ownership and ranking are not redefined")
    assert.match(sql, /limit 25/)
    assert.match(sql, /entry\.position <= 4/)
    assert.match(sql, /revoke all on function public\.read_team_work_queue\(uuid, uuid\) from public, anon, authenticated/)

    const column = source("components/workspace/TodayColumn.tsx")
    assert.match(column, /useState<"mine" \| "team">\("mine"\)/, "Team is never the starting scope, so it is never read at shell start")
    assert.match(column, /const showTeam = canSeeAttention && scope === "team"/)
    assert.match(column, /if \(!showTeam\) return/)
    assert.match(column, /\{canSeeAttention \? <SegmentedSwitch label="Queue scope"/, "staff are not offered Team")

    // @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
    const { parseTeamQueue, teamQueueRows } = await import("../lib/team-queue.ts")
    const now = Date.parse("2026-11-15T12:00:00Z")
    const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, description: null, status: "todo", created_at: "2026-11-14T12:00:00Z", updated_at: "2026-11-14T12:00:00Z", actual_start_at: null, due_at: null, planned_at: null, priority_override: null, blocked: false, paused: false, relationship: null, service: null, assessment: null, assessment_status: null, assessed_at: null, ...extra })
    const queue = parseTeamQueue({ truncated: false, people: [
        { userId: "sam", name: "Sam", ready: 3, items: [item("s1"), item("s2"), item("s3")] },
        { userId: "priya", name: " ", ready: 2, items: [item("p1"), item("shared", { status: "doing", shared: true, started_by: "sam" }), item("blocked", { blocked: true })] },
        { userId: "mia", name: "Mia", ready: 1, items: [item("shared", { status: "doing", shared: true, started_by: "sam" })] },
    ] })
    assert.ok(queue)
    assert.equal(queue.people[1].name, "Team member")
    const rows = teamQueueRows(queue, 12, now)
    assert.deepEqual(rows.map((row: { id: string }) => row.id), ["shared", "s1", "s2", "p1", "s3"], "in progress first, then people take turns in their own order; blocked work is left out")
    assert.equal(rows.filter((row: { id: string }) => row.id === "shared").length, 1, "a shared item appears once")
    assert.equal(teamQueueRows(queue, 2, now).length, 2)
    assert.equal(parseTeamQueue({ people: "no" }), null)
    assert.equal(parseTeamQueue({ people: [{ userId: 1, items: [] }] }), null)
})

test("Needs attention stays short: identical items merge and the queue comes first", () => {
    const column = source("components/workspace/TodayColumn.tsx")
    assert.match(column, /const ATTENTION_ROWS = 4\n/)
    assert.match(column, /const key = `\$\{group\.kind\}\\u0000\$\{item\.title\}\\u0000\$\{item\.client \?\? ""\}`/)
    assert.match(column, /const target = count > 1 \? attentionUrl : href/, "a merged row opens the full list, a single one opens its record")
    assert.match(column, /attentionTotal > attentionShown/, "the remainder counts items, not rows")
    assert.ok(column.indexOf('aria-labelledby="today-queue"') < column.indexOf('aria-labelledby="today-attention"'), "the queue is the first section")
})

test("a wrapped dependency list cannot be lifted over the Parent row", () => {
    const fields = source("app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields.tsx")
    assert.match(fields, /<DetailField multiline label="Dependencies" icon="dependency"[^>]*><div className="relative block max-w-full">/)
})

test("the docked chat column widens with the window and the work area reserves its width", () => {
    const css = source("app/globals.css")
    assert.match(css, /--workspace-dock-width: 20rem;/)
    assert.match(css, /@media \(min-width: 1280px\) \{ :root \{ --workspace-dock-width: 24rem; \} \}/)
    assert.match(css, /@media \(min-width: 1440px\) \{ :root \{ --workspace-dock-width: 26rem; \} \}/)
    assert.match(css, /@media \(min-width: 1680px\) \{ :root \{ --workspace-dock-width: 30rem; \} \}/)
    assert.match(css, /body\[data-workspace-dock="column"\] \[data-native-context-open="true"\] \[data-native-context-spacer\] \{ width: var\(--workspace-dock-width\); \}/)
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /"z-\[35\] w-\[var\(--workspace-dock-width\)\]"/)
    assert.match(shell, /if \(!dockColumnShown\) return\s*document\.body\.dataset\.workspaceDock = "column"/, "the wider reservation applies only while the column shows the chat")
    assert.match(source("components/workspace/ShellRelationshipContextPanel.tsx"), /hidden w-80 flex-col/, "the context reference keeps its 20rem width")
})

test("the Today top bar has one New menu and a short presence stack", async () => {
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /layout === "today" \? \(canCreateRelationship \|\| canCreateLibraryItem \|\| canCreateOkr\) && <ListActionMenu allowBelow label="Create something new"/, "one menu in the Today layout, and none for people who can create nothing")
    assert.match(shell, /canCreateOkr && \{ label: "OKR", onSelect: \(\) => openCreate\("okr"\) \}/, "each entry keeps its own permission")
    assert.match(shell, /\]\} \/> : <div className="hidden items-center gap-0\.5 md:flex" aria-label="Create">/, "the tabbed layout keeps its icon row")
    assert.match(shell, /max=\{layout === "today" \? 3 : undefined\}/)
    assert.match(shell, /sort\(\(left, right\) => Number\(right\.active\) - Number\(left\.active\)\)/, "connected people are shown first")

    // @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
    const { anchoredPopupPosition } = await import("../components/ui/anchored-popup-position.ts")
    const viewport = { left: 0, top: 0, width: 1280, height: 800 }
    const base = { popupWidth: 208, popupHeight: 180, viewport, align: "end" as const, allowBelow: true }
    assert.equal(anchoredPopupPosition({ ...base, trigger: { left: 1100, right: 1170, top: 10 } }).top, 16, "without a bottom edge a flipped menu keeps its old position")
    assert.equal(anchoredPopupPosition({ ...base, trigger: { left: 1100, right: 1170, top: 10, bottom: 46 } }).top, 52, "with it, the menu opens beneath the whole trigger")
    assert.equal(anchoredPopupPosition({ ...base, trigger: { left: 1100, right: 1170, top: 400, bottom: 436 } }).top, 400 - 6 - 180, "and still opens above when there is room")
    const menu = source("components/list/ListActionMenu.tsx")
    assert.match(menu, /clearTrigger=\{Boolean\(trigger\)\}/, "only a labelled trigger asks for it")
    assert.match(source("components/ui/AnchoredPopup.tsx"), /\.\.\.\(clearTrigger \? \{ bottom: rect\.bottom \} : \{\}\)/)
})

test("the Today client column is the dense form and other surfaces keep the full one", () => {
    const panel = source("components/workspace/ShellRelationshipContextPanel.tsx")
    assert.match(panel, /dense \? <div className="flex items-start justify-between gap-2">\s*<h2/, "dense starts with the client's name, with no panel label or record id above it")
    assert.match(panel, /<dt className=\{dense \? "sr-only" : "text-xs text-neutral-500"\}>\{label\}<\/dt>/, "contact labels stay for assistive technology")
    assert.match(panel, /<Assignee compact name=\{service\.assignee\.name\}/, "service owners are avatar-only, named by tooltip")
    assert.match(panel, /<RoundPill tone="emerald" className="min-w-0 shrink">\{service\.name\}<\/RoundPill><ServiceStage/, "the service name truncates before the stage or owner")
    assert.match(panel, /Relationship context <span className="ml-1 font-mono text-neutral-600">\{shortId\(context\.id\)\}<\/span>/, "the full form is still there for the tabbed layout and standalone pages")
    assert.match(source("components/workspace/WorkspaceTopBarClient.tsx"), /dense=\{layout === "today"\}/)
})

test("record pages are quieter in the Today layout without losing save state", () => {
    const css = source("app/globals.css")
    assert.match(css, /\nbody\[data-workspace-layout="today"\] \[data-detail-reference\],\nbody\[data-workspace-layout="today"\] \[data-detail-updated\],\nbody\[data-workspace-layout="today"\] \[data-detail-field-icon\] \{\n  display: none;/, "hidden by layout, at every width")
    const header = source("components/detail/DetailPageHeader.tsx")
    assert.match(header, /<p data-detail-reference [^>]*>\{category\} \{reference\}<\/p>/, "the component still renders the reference for other layouts")
    assert.match(header, /<h1 title=\{`\$\{category\} \$\{reference\}`\}/, "and it stays one hover away")
    assert.match(header, /<span data-detail-updated /)
    const field = source("components/work-items/WorkItemTextField.tsx")
    assert.doesNotMatch(field, /saves automatically`/, "no idle autosave note")
    for (const state of [/Review this draft before saving/, /`Saving \$\{label\.toLowerCase\(\)\}…`/, /Could not save automatically/, /will save automatically/, /`\$\{label\} saved`/]) assert.match(field, state, "every real save state is still reported")
    assert.match(field, /className=\{`min-h-4 text-xs/, "the line keeps its height so text never shifts the page")
})
