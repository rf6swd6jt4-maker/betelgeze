import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("the client rail opens everything through the shell's resident tab owner", () => {
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /\{layout === "today" \? <ClientRail workspaceSlug=\{workspace\.slug\}/, "the rail replaces the panel list only in the Today layout")
    assert.match(shell, /onOpenClient=\{\(href\) => \{ void openWorkspaceTab\(href\); closeSidebarAfterNavigation\(\) \}\}/)
    assert.match(shell, /if \(current && inPanel\(current\.url\)\) \{ void navigateActiveTab\(href\); return \}/, "already there: go to its first page")
    assert.match(shell, /if \(open\) \{ void switchTab\(open\); return \}/, "open elsewhere: a memory switch back to it")
    assert.match(shell, /\.filter\(\(item\) => item\.key !== "queue" && \(item\.key !== "communications" \|\| !canDockChat\)\)/, "Today and the docked Comms panel are not repeated among the destinations")
    assert.match(shell, /document\.body\.dataset\.workspaceLayout = layout/)
    assert.doesNotMatch(shell, /data-workspace-today-shell|TodayColumn|todaySheetOpen/, "the Today column and its phone sheet are gone")
    const rail = source("components/workspace/ClientRail.tsx")
    assert.doesNotMatch(rail, /router\.push|window\.location|useRouter/, "the rail never navigates on its own")
    assert.match(rail, /if \(!plainClick\(event\)\) return; event\.preventDefault\(\); if \(online\) onOpenClient\(href\)/, "a modified click keeps the browser's own behaviour")
})

test("the client rail reads one bounded list by name and never polls", async () => {
    const route = source("app/api/workspaces/[workspaceSlug]/client-rail/route.ts")
    assert.match(route, /requireWorkspaceAccess\(workspaceSlug\)/)
    assert.match(route, /x-workspace-user/)
    assert.match(route, /canAccessWorkspacePanel\(workspacePanelByKey\("relationships"\), role, access\.capabilities\)\) return Response\.json\(\{ allowed: false, clients: \[\]/, "people who cannot open relationships get no client names")
    assert.match(route, /const allowed = await accessibleRelationshipIds\(access\)/, "a scoped member sees only their own relationships")
    assert.match(route, /\.select\("id, primary_person_name, business_name"\)/, "three columns, not the Relationships panel's full list")
    assert.match(route, /\.eq\("workspace_id", workspace\.id\)\.neq\("status", "archived"\)/)
    assert.match(route, /\.order\("primary_person_name", \{ ascending: true \}\)/, "name order, which the existing workspace and person index serves")
    assert.match(route, /CLIENT_RAIL_LIMIT \+ 1 : SCOPED_SCAN_LIMIT/)
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/)
    const rail = source("components/workspace/ClientRail.tsx")
    assert.doesNotMatch(rail, /setInterval|setTimeout\(|subscribe\(\s*["']realtime/)
    assert.match(rail, /const STALE_MS = 5 \* 60_000/)
    assert.match(rail, /document\.visibilityState === "visible" && Date\.now\(\) - lastRead\.current >= STALE_MS/, "one read per shell, then only when the window returns after five minutes")
    assert.match(rail, /const railMemory = new Map</, "reopening the phone drawer reuses the list")

    // @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
    const { CLIENT_RAIL_LIMIT, clientInitials, filterRailClients, parseClientRail } = await import("../lib/client-rail.ts")
    assert.equal(clientInitials("Bruce Laing"), "BL")
    assert.equal(clientInitials("Mary Jane van der Berg"), "MB", "first and last word, as Communications shows them")
    assert.equal(clientInitials("Tariq"), "TA")
    assert.equal(clientInitials("élodie marchand"), "ÉM")
    assert.equal(clientInitials("  — "), "?")
    const rail1 = parseClientRail({ truncated: false, clients: [{ id: "a", name: " Bruce Laing ", business: "PRO Construction" }, { id: "b", name: "", business: "Howdy Lighting" }, { id: "c", name: null, business: null }] })
    assert.deepEqual(rail1, { truncated: false, clients: [{ id: "a", name: "Bruce Laing", business: "PRO Construction" }, { id: "b", name: "Howdy Lighting", business: null }, { id: "c", name: "Unnamed client", business: null }] })
    assert.equal(parseClientRail({ clients: "no" }), null)
    assert.equal(parseClientRail({ clients: [{ name: "No id" }] }), null)
    const long = parseClientRail({ clients: Array.from({ length: CLIENT_RAIL_LIMIT + 5 }, (_, index) => ({ id: `id-${index}`, name: `Client ${index}` })) })
    assert.equal(long.clients.length, CLIENT_RAIL_LIMIT)
    assert.equal(long.truncated, true)
    assert.deepEqual(filterRailClients(rail1.clients, " pro ").map((client: { id: string }) => client.id), ["a"], "the business name matches too")
    assert.deepEqual(filterRailClients(rail1.clients, "HOWDY").map((client: { id: string }) => client.id), ["b"])
    assert.equal(filterRailClients(rail1.clients, "").length, 3)
    assert.deepEqual(filterRailClients([{ id: "e", name: "Élodie Marchand", business: null }], "elodie").map((client: { id: string }) => client.id), ["e"], "accents do not block a match")
})

test("the frame changes only for the Today layout, and the rail widens without moving the page", () => {
    const css = source("app/globals.css")
    assert.match(css, /\nbody\[data-workspace-layout="today"\] \[data-workspace-tabbar\] \[role="tablist"\] \{\s*visibility: hidden;/, "tabs go at every width")
    assert.match(css, /\n  body\[data-workspace-layout="today"\] \[data-workspace-tabbar\] \{\s*display: none;/, "from lg up the emptied strip is removed")
    assert.match(css, /body\[data-workspace-layout="today"\] \[data-workspace-tab-panels\] \{\s*top: 3\.5rem;/, "and its height goes to the work area")
    assert.match(css, /body\[data-workspace-layout="today"\] \[data-workspace-context-column\] \{\s*top: 5rem;\s*height: calc\(100dvh - 6\.5rem\);/)
    assert.doesNotMatch(css, /--workspace-today-width|data-workspace-today-shell/, "no Today column is left in the frame")
    const hover = css.slice(css.indexOf("@media (min-width: 768px) and (hover: hover) {"), css.indexOf("@media (min-width: 768px) and (hover: none) {"))
    assert.match(hover, /\[data-workspace-sidebar\]\[data-client-rail\]\[data-collapsed="true"\]:is\(:hover, :has\(:focus-visible\)\) \{\s*width: 17rem;/)
    assert.doesNotMatch(hover, /--workspace-sidebar-width/, "hovering never changes the offset the page is laid out against")
    assert.match(hover, /:not\(:hover, :has\(:focus-visible\)\) \[data-rail-label\] \{\s*position: absolute;/, "names are clipped, not removed, so they stay in the accessibility tree")
    assert.match(css, /@media \(min-width: 768px\) and \(hover: none\) \{\s*\[data-workspace-sidebar\]\[data-client-rail\]\[data-collapsed="true"\] \[data-rail-wide\] \{\s*display: none;/, "touch tablets keep the narrow rail until it is pinned")
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /<aside data-workspace-sidebar data-client-rail=\{layout === "today" \? "" : undefined\}/)
    assert.doesNotMatch(shell, /data-today-context-toggle/, "the client column has no toggle in the Today layout")
})

test("the Needs attention route is owner/admin only, account-checked and read-only", () => {
    const route = source("app/api/workspaces/[workspaceSlug]/needs-attention/route.ts")
    assert.match(route, /requireWorkspace\(workspaceSlug, "admin"\)/)
    assert.match(route, /x-workspace-user/)
    assert.match(route, /workspace_needs_attention/)
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/)
})

test("Today is the queue page, with the team's sections beside it for owners and admins", () => {
    const page = source("components/workspace/NativeQueuePanel.tsx")
    assert.match(page, /const today = useTodayLayout\(\)\n    if \(!today\) return <div className="mx-auto max-w-7xl px-4 pb-7 text-white sm:px-6"><PersonalWorkQueue data=\{data\} \/><\/div>/, "the tabbed layout keeps the Work Queue page exactly")
    assert.match(page, /<PersonalWorkQueue data=\{data\} title="Today" \/>/, "the same full queue, so nothing it shows is lost")
    assert.match(page, /\{data\.canSeeAttention \? <div className="min-w-0 @4xl:pt-6"><TodaySide /, "staff get the queue alone")
    assert.ok(page.indexOf("<PersonalWorkQueue data={data} title") < page.indexOf("<TodaySide "), "the person's own queue comes first")
    assert.match(source("components/work-queue/PersonalWorkQueue.tsx"), /<PanelTabHeader title=\{title\} /)
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /layout === "today" \? <button type="button" data-today-button onClick=\{event => \{ event\.currentTarget\.focus\(\{ preventScroll: true \}\); setSidebarOpen\(false\); openTodayDestination\(todayHref\) \}\}/)
    assert.match(shell, /md:hidden">Today<\/button>/, "phones only: from md up the rail's Today is always on screen")
    assert.match(shell, /<TodayLayoutProvider value=\{todayShell\}>/)
    assert.match(shell, /const todayShell = useMemo<TodayLayoutShell \| null>\(\(\) => layout === "today" \? \{/, "pages in the tabbed layout get no Today shell")
})

test("returning to Today within a minute reuses Needs attention", () => {
    const side = source("components/workspace/TodaySide.tsx")
    assert.match(side, /const attentionMemory = new Map</)
    assert.match(side, /const REFRESH_MS = 60_000/)
    assert.match(side, /document\.visibilityState === "visible" && Date\.now\(\) - lastAttention\.current >= REFRESH_MS\) void loadAttention\(controller\.signal\)/)
    assert.doesNotMatch(side, /setInterval|setTimeout\(|router\.push|window\.location|<a\b|href=\{/, "no timers, and it never navigates on its own")
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

test("the Today side sections use single-target compact rows", () => {
    const side = source("components/workspace/TodaySide.tsx")
    assert.match(side, /<ListCompactItem key=\{item\.id\} onOpen=\{\(\) => onOpen\(`\/\$\{workspaceSlug\}\/work-items\/\$\{item\.id\}`\)\}/)
    const list = source("components/list/List.tsx")
    assert.match(list, /export function ListCompactItem/)
    assert.match(list, /aria-current=\{current \? "page" : undefined\}/)
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /layout === "today" \? <p data-today-destination/)
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
        assert.equal(workspaceDocumentIsActive(), false, "a hidden dock reads nothing")
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
    const writers = ["components/workspace/WorkspaceTopBarClient.tsx", "components/workspace/ShellRelationshipContextPanel.tsx", "components/workspace/TodaySide.tsx", "components/workspace/ClientRail.tsx", "components/relationships/ClientSummary.tsx"]
    for (const path of writers) assert.doesNotMatch(source(path), /workspaceDockedTabId/, `${path} must not name the dock itself`)

    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /const canDockChat = layout === "today" && todayWide && canAccessWorkspacePanel\(workspacePanelByKey\("communications"\)/, "Today layout, desktop width, Communications access")
    assert.match(shell, /const dockShown = Boolean\(dock && \(dock\.place === "drawer"\s*\|\| \(!activeRouteLoading && activeRelationshipContext\?\.id === dock\.relationshipId\)\)\)/, "a client's chat is on screen only beside that client's own pages")
    assert.match(source("components/workspace/TodayLayout.tsx"), /const WIDE_QUERY = "\(min-width: 1024px\)"/)
    assert.doesNotMatch(shell, /Open full view/, "the docked panel is the one way to Comms at desktop width")
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

    const side = source("components/workspace/TodaySide.tsx")
    assert.match(side, /const \[teamOpen, setTeamOpen\] = useState\(false\)/, "the Team queue always starts closed, so it is never read at shell start")
    assert.match(side, /if \(!teamOpen\) return/)
    assert.match(source("components/workspace/NativeQueuePanel.tsx"), /\{data\.canSeeAttention \? <div className="min-w-0 @4xl:pt-6"><TodaySide /, "staff are not offered the Team queue")

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

test("Needs attention stays short: identical items merge into one row", () => {
    const side = source("components/workspace/TodaySide.tsx")
    assert.match(side, /const ATTENTION_ROWS = 4\n/)
    assert.match(side, /const key = `\$\{group\.kind\}\\u0000\$\{item\.title\}\\u0000\$\{item\.client \?\? ""\}`/)
    assert.match(side, /const target = count > 1 \? attentionUrl : href/, "a merged row opens the full list, a single one opens its record")
    assert.match(side, /attentionTotal > attentionShown/, "the remainder counts items, not rows")
})

test("a wrapped dependency list cannot be lifted over the Parent row", () => {
    const fields = source("app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields.tsx")
    assert.match(fields, /<DetailField multiline label="Dependencies" icon="dependency"[^>]*><div className="relative block max-w-full">/)
})

test("the docked Comms panel widens with the window and the work area ends where it begins", () => {
    const css = source("app/globals.css")
    assert.match(css, /--workspace-dock-width: 20rem;/)
    assert.match(css, /@media \(min-width: 1280px\) \{ :root \{ --workspace-dock-width: 24rem; \} \}/)
    assert.match(css, /@media \(min-width: 1440px\) \{ :root \{ --workspace-dock-width: 26rem; \} \}/)
    assert.match(css, /@media \(min-width: 1680px\) \{ :root \{ --workspace-dock-width: 30rem; \} \}/)
    assert.match(css, /body\[data-workspace-layout="today"\]\[data-workspace-dock="shown"\] \[data-workspace-tab-panels\] \{\s*width: calc\(100% - var\(--workspace-sidebar-width\) - var\(--workspace-dock-width\)\);/, "native panels and framed pages alike are never covered")
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /fixed bottom-0 right-0 top-14 z-\[35\] w-\[var\(--workspace-dock-width\)\]/)
    assert.match(shell, /if \(!dockShown\) return\s*document\.body\.dataset\.workspaceDock = "shown"/, "the work area gives up the width only while the panel is on screen")
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

test("the Today client column is the dense form, shown beside records but not on the client's own page", () => {
    const panel = source("components/workspace/ShellRelationshipContextPanel.tsx")
    assert.match(panel, /dense \? <div className="flex items-start justify-between gap-2">\s*<h2/, "dense starts with the client's name, with no panel label or record id above it")
    assert.match(panel, /<dt className=\{dense \? "sr-only" : "text-xs text-neutral-500"\}>\{label\}<\/dt>/, "contact labels stay for assistive technology")
    assert.match(panel, /<Assignee compact name=\{service\.assignee\.name\}/, "service owners are avatar-only, named by tooltip")
    assert.match(panel, /<RoundPill tone="emerald" className="min-w-0 shrink">\{service\.name\}<\/RoundPill><ServiceStage/, "the service name truncates before the stage or owner")
    assert.match(panel, /Relationship context <span className="ml-1 font-mono text-neutral-600">\{shortId\(context\.id\)\}<\/span>/, "the full form is still there for the tabbed layout and standalone pages")
    assert.match(panel, /\{onChat \? <div className="mt-3"><Button variant="secondary" size="sm" data-context-chat onClick=\{onChat\}>Chat<\/Button><\/div> : null\}/, "Chat is one button, not a two-way switch")
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /dense=\{layout === "today"\}/)
    assert.match(shell, /const activeIsClientPage = layout === "today" && isClientPage\(activeTab\.url\)/)
    assert.match(shell, /\{activeRelationshipContext && !activeRouteLoading && !activeIsClientPage && \(\s*<ShellRelationshipContextPanel/, "work items, assets, notes and onboarding keep the column; the client's page does not repeat itself")
    assert.match(shell, /desktopOpen=\{activeContextOpen && !dockShown\}/, "the docked Comms panel takes the column's place while it is open")
    assert.match(shell, /contextOpen=\{layout === "today" \? !isClientPage\(tab\.url\) && !dockShown : contextOpenByTab\[tab\.id\] \?\? true\}/, "native pages reserve the column's width only while it is shown")
})

test("the client's own page carries what the client column showed", () => {
    const page = source("components/workspace/NativeRelationshipsPanel.tsx")
    assert.match(page, /const context = today \? data\.context : null/, "only in the Today layout")
    assert.match(page, /\{context \? <ClientSummary context=\{context\} workspaceSlug=\{data\.workspaceSlug\}/)
    assert.match(page, /today && Object\.hasOwn\(relationshipPhaseTones, record\.phase\) \? <RelationshipStage phase=/, "the lifecycle stage is a header label")
    const summary = source("components/relationships/ClientSummary.tsx")
    assert.match(summary, /<DetailFields>/, "contact, manager and source use the shared fields block")
    assert.match(summary, /destination\.key !== "relationships" && context\.allowedDestinations\?\.includes\(destination\.key\)/, "onward links keep their permissions and never point at this page")
    assert.match(summary, /\{onChat \? <Button size="sm" data-client-chat onClick=\{onChat\}>Chat<\/Button> : <Button size="sm" data-client-chat href=\{chatHref\}>Chat<\/Button>\}/, "where the dock is not offered, Chat opens the full conversation")
    assert.doesNotMatch(summary, /fetch\(/, "it renders the context the page already loaded; no request is added")
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
