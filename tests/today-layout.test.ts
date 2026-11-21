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
    assert.match(shell, /const railKeys = canOpenClients \? \["relationships", "communications", "library", "staff", "settings"\]\n\s+: \["onboarding", "client-connections", "communications", "library", "staff", "settings"\]/, "one way into each thing: Onboarding and Client Connections are tabs on a client's page, unless the person cannot open Clients at all")
    assert.match(shell, /\.filter\(\(item\) => railKeys\.includes\(item\.key\) && \(item\.key !== "communications" \|\| !canDockChat\)\)/, "Today and the docked Comms panel are not repeated among the destinations")
    assert.match(shell, /label: item\.key === "relationships" \? "Clients" : item\.label/)
    assert.match(shell, /\(item\.key === "settings" \? \[\.\.\.item\.activeHrefs, \.\.\.settingsAreaHrefs\] : item\.activeHrefs\)/, "Admin is reached from Settings, so Settings stays marked there")
    assert.match(shell, /document\.body\.dataset\.workspaceLayout = layout/)
    assert.doesNotMatch(shell, /data-workspace-today-shell|TodayColumn|todaySheetOpen/, "the Today column and its phone sheet are gone")
    const rail = source("components/workspace/ClientRail.tsx")
    assert.doesNotMatch(rail, /router\.push|window\.location|useRouter/, "the rail never navigates on its own")
    assert.doesNotMatch(rail, /moreOpen|More<\/span>|primary/, "there is no More: nothing in the sidebar opens, closes or reorders")
    assert.match(rail, /<Destination item=\{item\} count=\{item\.key === "relationships" \? clientCount : undefined\}/, "the Clients row counts from the list the sidebar already read")
    assert.match(rail, /const current = activePath === href \|\| client\.id === activeClientId/, "a client stays marked on records that belong to them")
    assert.match(shell, /const todayFrameContextOpen = layout === "today" && activeContextSupported \? activeContextOpen && !dockShown : null/, "framed pages give the column's room back when the docked panel takes that side")
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
    assert.match(hover, /\[data-workspace-sidebar\]\[data-client-rail\]\[data-collapsed="true"\]:is\(:hover, :has\(:focus-visible\)\) \{\s*width: 15rem;/)
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

test("the Today layout has no client column at desktop width; the breadcrumb names the client", () => {
    const panel = source("components/workspace/ShellRelationshipContextPanel.tsx")
    assert.match(panel, /Relationship context <span className="ml-1 font-mono text-neutral-600">\{shortId\(context\.id\)\}<\/span>/, "the full form is still there for the tabbed layout and standalone pages")
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /const activeIsClientPage = layout === "today" && clientPageRelationshipId\(activeTab\.url, workspace\.slug\) !== null/)
    assert.match(shell, /const activeContextOpen = activeContextSupported && layout !== "today" && \(contextOpenByTab\[activeTab\.id\] \?\? true\)/, "the column is never open at desktop width in the Today layout")
    assert.match(shell, /contextOpen=\{layout === "today" \? false : contextOpenByTab\[tab\.id\] \?\? true\}/, "native pages reserve no room for it")
    assert.match(shell, /\{activeRelationshipContext && !activeRouteLoading && !activeIsClientPage && \(\s*<ShellRelationshipContextPanel/, "below lg the context sheet stays for records, and never on the client's own pages")
    assert.match(shell, /<nav data-today-breadcrumb aria-label="Where you are" className="hidden min-w-0 items-center gap-1\.5 text-sm lg:flex">/)
    assert.match(shell, /\{ label: crumbClientName, target: activeIsClientPage \|\| !canOpenClients \? undefined : "client" \},\n\s+\.\.\.\(activeIsClientPage \? \[\] : \[\{ label: todayTitle \}\]\),/, "a record that belongs to a client reads Clients / client / record, and the first two parts are ways back")
    assert.match(shell, /if \(target === "clients"\) openTodayDestination\(clientsHref\)\n\s+else if \(activeClientId\) void openWorkspaceTab\(`\$\{clientsHref\}\/\$\{activeClientId\}`\)/, "both go through the shell's resident owner")
})

test("a client's page is one header with a tab for each thing of theirs", async () => {
    // @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
    const { clientPageTabs, clientPageRelationshipId, clientPageActiveTab } = await import("../lib/client-page.ts")
    const id = "11111111-2222-4333-8444-555555555555"
    assert.deepEqual(clientPageTabs("acme", id, ["relationships", "onboarding", "fulfilment", "client-connections"]).map((tab: { key: string; href: string }) => [tab.key, tab.href]), [
        ["overview", `/acme/relationships/${id}`], ["work", `/acme/work/${id}`], ["onboarding", `/acme/onboarding/${id}`],
        ["connections", `/acme/client-connections?relationship=${id}`], ["files", `/acme/relationships/${id}?tab=files`],
    ], "every tab is an existing route")
    assert.deepEqual(clientPageTabs("acme", id, ["fulfilment"]).map((tab: { key: string }) => tab.key), ["work"], "a person sees only the tabs they may open")
    assert.equal(clientPageRelationshipId(`/acme/relationships/${id}?tab=files`, "acme"), id)
    assert.equal(clientPageRelationshipId(`/acme/work/${id}`, "acme"), id)
    assert.equal(clientPageRelationshipId(`/acme/onboarding/${id}?session=${id}`, "acme"), id)
    assert.equal(clientPageRelationshipId(`/acme/client-connections?relationship=${id}`, "acme"), id)
    assert.equal(clientPageRelationshipId("/acme/client-connections", "acme"), null, "the unfiltered collection is nobody's page")
    assert.equal(clientPageRelationshipId(`/acme/work-items/${id}`, "acme"), null, "a work item is a record, not one of the client's pages")
    assert.equal(clientPageRelationshipId(`/other/relationships/${id}`, "acme"), null)
    assert.equal(clientPageRelationshipId("/acme/relationships/not-an-id", "acme"), null)
    assert.equal(clientPageActiveTab(`/acme/relationships/${id}`, "acme"), "overview")
    assert.equal(clientPageActiveTab(`/acme/relationships/${id}?tab=files`, "acme"), "files")
    assert.equal(clientPageActiveTab(`/acme/client-connections?relationship=${id}`, "acme"), "connections")
    assert.equal(clientPageActiveTab("/acme/queue", "acme"), null)

    const header = source("components/relationships/ClientPageHeader.tsx")
    assert.match(header, /<header data-client-page-header data-workspace-record-title=\{name\}>/, "the destination is still titled by the client's name")
    assert.match(header, /if \(!navigation \|\| !current \|\| pathOf\(tab\.href\) !== pathOf\(current\.href\)\) return/, "only two sections of the same route switch in place; every other tab is an ordinary link the shell handles")
    assert.match(header, /\{onChat \? <Button size="sm" data-client-chat onClick=\{onChat\}>Chat<\/Button> : chatHref \? <Button size="sm" data-client-chat href=\{chatHref\}>Chat<\/Button> : null\}/, "Chat is the page's one primary action; where the dock is not offered it opens the full conversation")
    assert.doesNotMatch(header, /fetch\(|router\.push|window\.location/, "it reads nothing and never navigates on its own")

    const page = source("components/workspace/NativeRelationshipsPanel.tsx")
    assert.match(page, /return today \? <ClientDetail data=\{data\} today=\{today\} \/> : <RelationshipDetail data=\{data\} \/>/, "only in the Today layout")
    assert.match(page, /<div hidden=\{section !== "overview"\} data-client-section="overview"/)
    assert.match(page, /<div hidden=\{section !== "files"\} data-client-section="files"/, "Overview and Files and notes both stay mounted, so drafts survive the switch and nothing is read again")
    assert.match(page, /data\.context\?\.clientTabs \?\? data\.context\?\.allowedDestinations \?\? \["relationships"\]/)
    assert.match(page, /<DetailDangerAction title="Archive client"[\s\S]*<DetailDangerAction title="Delete client permanently"/, "archive stays before delete")
    const summary = source("components/relationships/ClientSummary.tsx")
    assert.match(summary, /<DetailFields columns=\{1\}/, "contact, manager and source use the shared fields block, in one column beside the overview")
    assert.doesNotMatch(summary, /<Button|relationshipContextDestinations/, "no buttons: the tabs are the way to the client's other things")
    assert.doesNotMatch(summary, /fetch\(/, "it renders the context the page already loaded; no request is added")

    const work = source("components/workspace/NativeWorkPanel.tsx")
    assert.match(work, /return today \? <ClientWork data=\{data\} today=\{today\} \/> : <WorkDetail data=\{data\} \/>/)
    assert.match(work, /active="work"/)
    const onboarding = source("app/[workspaceSlug]/onboarding/[relationshipId]/page.tsx")
    assert.match(onboarding, /const today = workspaceLayoutFor\(workspace\.id, user\.id\) === "today"/)
    assert.match(onboarding, /\{today \? <FramedClientPageHeader [\s\S]*active="onboarding"[\s\S]*: <DetailPageHeader/, "the tabbed layout keeps the record header")
    const connections = source("app/[workspaceSlug]/client-connections/page.tsx")
    assert.match(connections, /const clientTab = relationshipId && workspaceLayoutFor\(authorization\.workspace\.id, authorization\.user\.id\) === "today" \? relationshipId : null/, "the unfiltered page and the tabbed layout read nothing more")
    assert.match(connections, /clientTab \? requireRelationshipAccess\(authorization\.access, clientTab\)\.then\(\(\) => getRelationship\(authorization\.workspace\.id, clientTab\)\) : null,/, "one single-row read, beside the page's own two, after the access check")
    assert.match(connections, /active="connections" chat=\{false\}/, "this page reports no client to the shell, so it offers no docked chat")
})

test("a framed client page asks the shell for Chat, and the shell decides where it opens", () => {
    const framed = source("components/relationships/FramedClientPageHeader.tsx")
    assert.match(framed, /type: "client-chat",\s+relationshipId, title: business\?\.trim\(\) \|\| name,/)
    assert.match(framed, /window\.parent\.postMessage\(message, window\.location\.origin\)/, "same-origin only")
    assert.match(framed, /onChat=\{chat && tabId \? askShell : undefined\} chatHref=\{chat && !tabId \? chatHref : undefined\}/, "outside a frame Chat is a plain link")
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /if \(message\.type === "client-chat" && message\.relationshipId && message\.title && \/\^\[0-9a-f\]\{8\}-\(\?:\[0-9a-f\]\{4\}-\)\{3\}\[0-9a-f\]\{12\}\$\/i\.test\(message\.relationshipId\)\)/, "only a well-formed client id is accepted")
    assert.match(shell, /if \(layout !== "today"\) return\n\s+if \(canDockChat\) openClientChat\(client\)\n\s+else void openWorkspaceTab\(/, "docked where the panel is offered, the full conversation otherwise; the dock owner and read rule are unchanged")
})

test("Clients is one table with saved views answered from the list already read", () => {
    const page = source("components/workspace/NativeRelationshipsPanel.tsx")
    assert.match(page, /if \(data\.kind === "relationships"\) return today \? <ClientsTable data=\{data\} \/> : <RelationshipList data=\{data\} \/>/)
    assert.match(page, /\{ key: "open-work", label: "Open work", match: row => row\.openWork > 0 \},\n\s+\{ key: "no-manager", label: "No manager", match: row => !row\.managed \},\n\s+\{ key: "no-services", label: "No services", match: row => row\.serviceCount === 0 \},/)
    assert.match(page, /instant=\{\{ param: "view", value: entry\.key \}\}/, "choosing a view is instant and URL-backed")
    assert.match(page, /next\.delete\("serviceStage"\)/, "an older service-stage link is restated as a view once")
    const table = page.slice(page.indexOf("function ClientsTable"), page.indexOf("function ClientDetail"))
    assert.doesNotMatch(table, /fetch\(|useState\(/, "no request and no second copy of the rows")
    assert.match(table, /<Link href=\{`\$\{href\}\/\$\{row\.id\}`\} prefetch=\{false\} data-table-open data-workspace-detail-preview=\{serializeWorkspaceDetailPreview\(/, "the client's name is the one link, the row follows it, and the opening page already knows who it is")
    const loader = source("lib/workspace-native-relationships.ts")
    assert.match(loader, /const profileIds = \[\.\.\.new Set\(\[\.\.\.creatorIds, \.\.\.rows\.flatMap\(\(row\) => row\.fulfilment_manager_user_id \? \[row\.fulfilment_manager_user_id\] : \[\]\)\]\)\]/, "manager names ride on the creators' profile lookup")
    assert.equal((loader.match(/from\("user_profiles"\)/g) ?? []).length, 1, "still one profile query")
    const primitive = source("components/list/Table.tsx")
    assert.match(primitive, /event\.currentTarget\.querySelector<HTMLAnchorElement>\("a\[data-table-open\]"\)\?\.click\(\)/)
    assert.match(primitive, /closest\("a, button, input, select, textarea, label, \[role='button'\]"\)/, "a control inside a row keeps its own behaviour")
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

test("the phone bottom bar reserves its own space and never covers a conversation", () => {
    const bar = source("components/workspace/PhoneBottomBar.tsx")
    assert.match(bar, /if \(phone\.matches && !keyboard\) document\.body\.dataset\.workspacePhoneBar = "shown"/, "space is reserved only while the bar is really on screen")
    assert.match(bar, /<nav data-workspace-bottom-bar aria-label="Main" hidden=\{keyboard\}/, "it gives way to the on-screen keyboard")
    assert.match(bar, /md:hidden">/, "phones only")
    assert.doesNotMatch(bar, /setInterval|setTimeout\(|router\.push|window\.location|fetch\(/, "no timers, requests or navigation of its own")
    assert.doesNotMatch(bar, /dataset\.workspaceBottomBar/, "the body's attribute never shares the bar's own name, which the hide rule matches")
    const css = source("app/globals.css")
    assert.match(css, /body\[data-workspace-phone-bar="shown"\] \{\s*--workspace-bottom-bar: calc\(3\.5rem \+ env\(safe-area-inset-bottom, 0px\)\);/)
    assert.match(css, /html\[data-mobile-conversation-open="true"\] \[data-workspace-bottom-bar\] \{\s*display: none;/, "an open phone conversation is never shared with the bar")
    const phone = css.slice(css.indexOf("/* Phone bottom bar (Today layout"), css.indexOf("html[data-mobile-conversation-open=\"true\"] [data-workspace-bottom-bar]"))
    assert.equal((css.match(/--workspace-bottom-bar/g) ?? []).length, (phone.match(/--workspace-bottom-bar/g) ?? []).length, "the bar's height is used only inside its own block")
    for (const rule of phone.split("\n\n").filter(part => part.includes("var(--workspace-bottom-bar)"))) assert.match(rule, /body\[data-workspace-phone-bar="shown"\]/, "and only by rules that apply while the bar is on screen")
    assert.match(css, /html\[data-workspace-viewport-locked="true"\] \[data-workspace-tab-panels\] \{\s*top: calc\(6\.25rem \+ var\(--workspace-visual-origin-offset, 0px\)\);\s*bottom: auto;\s*height: max\(0px, calc\(var\(--workspace-visual-viewport-bottom, 100dvh\) - 6\.25rem\)\);/, "the existing phone chat sizing rule is untouched")
    assert.doesNotMatch(css, /body\[data-workspace-bottom-bar/)
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /\{layout === "today" \? <PhoneBottomBar items=\{\[/, "only the Today layout has the bar")
    assert.match(shell, /key: "clients", label: "Clients", icon: <RelationshipsIcon \/>, expanded: drawerOpen, onSelect: toggleSidebar/)
    assert.match(shell, /const drawerOpen = sidebarOpen && \(layout !== "today" \|\| sidebarHydrated\)/, "the names sidebar starts open from md up, but a phone's drawer is never open before its state is read")
    assert.match(shell, /\$\{layout === "today" \? "hidden md:inline-flex" : "inline-flex"\}/, "on phones the bar replaces the top bar's sidebar button")
    assert.doesNotMatch(shell, /data-today-button/, "and the strip's Today button")
    const rail = source("components/workspace/ClientRail.tsx")
    assert.match(rail, /className=\{phoneBar && item\.key === "communications" \? "max-md:hidden" : undefined\}/, "the phone drawer does not repeat what the bar holds")
})
