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
    assert.match(rail, /<RailDestinationRow key=\{item\.key\} item=\{item\} count=\{item\.key === "relationships" \? clientCount : undefined\}/, "the Clients row counts from the list the sidebar already read")
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
    assert.match(rail, /const railMemory = new Map</, "a remount reuses the list")
    assert.match(rail, /const SIDEBAR_QUERY = "\(min-width: 768px\)"/)
    assert.match(rail, /const refresh = \(\) => \{ if \(shown\.matches && document\.visibilityState === "visible"/, "a phone has no sidebar, so its list is not read there")
    assert.match(rail, /shown\.addEventListener\("change", refresh\)/, "widening the window reads it then")
    assert.match(rail, /if \(!window\.matchMedia\(SIDEBAR_QUERY\)\.matches\) \{ lastRead\.current = 0; return \}/, "a change made while it is not shown marks the list stale instead of reading it")

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
    assert.match(shell, /layout === "today" \? <nav data-today-destination aria-label="Where you are" className="pointer-events-none absolute inset-0 /, "below lg the strip is the breadcrumb")
    const strip = shell.slice(shell.indexOf("<nav data-today-destination"), shell.indexOf("</nav>", shell.indexOf("<nav data-today-destination")))
    assert.match(strip, /crumb\.target \? <button type="button" data-icon-button onClick=\{\(\) => openCrumb\(crumb\.target!\)\} className="pointer-events-auto inline-flex h-11 /, "its earlier parts lead back, at a touch size")
    assert.doesNotMatch(shell, /stripTitle/)
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

test("a client's page is one destination whose tabs are sections of it", async () => {
    // @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
    const { clientPageTabs, clientPageRelationshipId, clientPageActiveTab, clientPageSection } = await import("../lib/client-page.ts")
    const id = "11111111-2222-4333-8444-555555555555"
    assert.deepEqual(clientPageTabs("acme", id, ["relationships", "onboarding", "fulfilment", "client-connections"]).map((tab: { key: string; href: string }) => [tab.key, tab.href]), [
        ["overview", `/acme/relationships/${id}`], ["work", `/acme/relationships/${id}?tab=work`], ["onboarding", `/acme/relationships/${id}?tab=onboarding`],
        ["connections", `/acme/relationships/${id}?tab=connections`], ["files", `/acme/relationships/${id}?tab=files`],
    ], "every tab is a section of the one relationship page, so no frame and no second destination is involved")
    assert.deepEqual(clientPageTabs("acme", id, ["onboarding", "fulfilment"]).map((tab: { key: string; href: string }) => [tab.key, tab.href]), [
        ["work", `/acme/work/${id}`], ["onboarding", `/acme/onboarding/${id}`],
    ], "someone who cannot open the relationship page keeps the standalone pages they may open")
    assert.deepEqual(clientPageTabs("acme", id, ["relationships"]).map((tab: { key: string }) => tab.key), ["overview", "files"], "a person sees only the tabs they may open")
    assert.equal(clientPageSection("onboarding"), "onboarding")
    assert.equal(clientPageSection("nonsense"), "overview")
    assert.equal(clientPageSection(null), "overview")
    assert.equal(clientPageRelationshipId(`/acme/relationships/${id}?tab=connections`, "acme"), id)
    assert.equal(clientPageRelationshipId(`/acme/work/${id}`, "acme"), id)
    assert.equal(clientPageRelationshipId(`/acme/onboarding/${id}?session=${id}`, "acme"), id)
    assert.equal(clientPageRelationshipId(`/acme/client-connections?relationship=${id}`, "acme"), id)
    assert.equal(clientPageRelationshipId("/acme/client-connections", "acme"), null, "the unfiltered collection is nobody's page")
    assert.equal(clientPageRelationshipId(`/acme/work-items/${id}`, "acme"), null, "a work item is a record, not one of the client's pages")
    assert.equal(clientPageRelationshipId(`/other/relationships/${id}`, "acme"), null)
    assert.equal(clientPageRelationshipId("/acme/relationships/not-an-id", "acme"), null)
    assert.equal(clientPageActiveTab(`/acme/relationships/${id}`, "acme"), "overview")
    assert.equal(clientPageActiveTab(`/acme/relationships/${id}?tab=work`, "acme"), "work")
    assert.equal(clientPageActiveTab(`/acme/relationships/${id}?tab=connections`, "acme"), "connections")
    assert.equal(clientPageActiveTab(`/acme/client-connections?relationship=${id}`, "acme"), "connections")
    assert.equal(clientPageActiveTab("/acme/queue", "acme"), null)

    const header = source("components/relationships/ClientPageHeader.tsx")
    assert.match(header, /<header data-client-page-header data-workspace-record-title=\{name\}>/, "the destination is still titled by the client's name")
    assert.match(header, /if \(!navigation \|\| !current \|\| pathOf\(tab\.href\) !== pathOf\(current\.href\)\) return/, "sections of the same route switch in place; any other link is left to the shell")
    assert.match(header, /onPointerEnter=\{onWarm && tab\.key !== active \? \(\) => onWarm\(tab\.key\) : undefined\}/, "pointing at a tab may start its section's read")
    assert.match(header, /\{onChat \? <Button size="sm" data-client-chat onClick=\{onChat\}>Chat<\/Button> : chatHref \? <Button size="sm" data-client-chat href=\{chatHref\}>Chat<\/Button> : null\}/, "Chat is the page's one primary action; where the dock is not offered it opens the full conversation")
    assert.doesNotMatch(header, /fetch\(|router\.push|window\.location/, "it reads nothing and never navigates on its own")

    const page = source("components/workspace/NativeRelationshipsPanel.tsx")
    assert.match(page, /return today \? <ClientDetail data=\{data\} today=\{today\} \/> : <RelationshipDetail data=\{data\} \/>/, "only in the Today layout")
    const detail = page.slice(page.indexOf("function ClientDetail"), page.indexOf("function RelationshipDetail"))
    assert.match(detail, /const section = may\(requested\) \? requested : "overview"/, "a section the person may not open is never shown, whatever the address says")
    for (const key of ["overview", "work", "onboarding", "connections", "files"]) assert.match(detail, new RegExp(`<div hidden=\\{section !== "${key}"\\} data-client-section="${key}"`), `${key} is a section of this page`)
    assert.match(detail, /\{may\("onboarding"\) && opened\.includes\("onboarding"\) \? <div hidden=/, "Onboarding is mounted the first time it is opened, then stays")
    assert.match(detail, /\{may\("connections"\) && opened\.includes\("connections"\) \? <div hidden=/, "and so is Connections")
    assert.match(detail, /if \(key === "onboarding"\) warmClientOnboarding\(target\); else if \(key === "connections"\) warmClientConnections\(target\)/)
    assert.match(detail, /<RelationshipBackgroundEditor key=\{`\$\{data\.userId\}:\$\{record\.id\}:background`\} fields=\{false\}/, "the editable details are placed by the page, in its Details column")
    assert.match(detail, /\{parts\.queue\(\{ limit: 5, onMore: may\("work"\) \? \(\) => go\("work"\) : undefined \}\)\}/, "Overview shows the next few items and leads to Work for the rest")
    assert.match(detail, /<section aria-label="Open work"><SectionHeading>Open work<\/SectionHeading>\{parts\.queue\(\)\}<\/section>\s*<section aria-label="Timeline"><SectionHeading>Timeline<\/SectionHeading>\{parts\.timeline\}<\/section>/, "the timeline lives with the work")
    assert.match(detail, /\{may\("work"\) \? null : <section aria-label="Timeline" className="order-9 @4xl:order-none">/, "someone without the Work tab still sees the timeline")
    assert.match(detail, /<DetailDangerAction title="Archive client"[\s\S]*<DetailDangerAction title="Delete client permanently"/, "archive stays before delete")
    assert.doesNotMatch(detail, /AttachmentCard|<Card\b|rounded-xl border/, "no cards on the client page")

    const workspace = source("components/relationships/RelationshipServicesWorkspace.tsx")
    assert.match(workspace, /return <>\{props\.render\(\{ timeline, queue, services, contacts, addService: props\.canAdd \? startAdding : undefined \}\)\}\{dialogs\}<\/>/, "the page arranges the parts; every dialog and command stays with the workspace")
    const queue = source("components/relationships/RelationshipServiceTimeline.tsx")
    assert.match(queue, /setVisible\(previous => compact \? previous \|\| seen : seen\)/, "the one-line queue does not read again each time its tab is shown")
    const summary = source("components/relationships/ClientSummary.tsx")
    assert.doesNotMatch(summary, /<Button|fetch\(|ContactLink/, "manager and source only, from the context the page already loaded")
    const contacts = source("components/relationships/RelationshipContactCards.tsx")
    assert.match(contacts, /<li key=\{method\}><button type="button" data-icon-button onClick=\{\(\) => open\(method\)\}/, "each way to reach the client is one row that opens the same dialog as its card did")
})

test("Onboarding and Connections each make one bounded read, behind the checks their pages make", async () => {
    const connections = source("app/api/workspaces/[workspaceSlug]/relationships/[relationshipId]/connections/route.ts")
    assert.match(connections, /await requireWorkspacePanel\(workspaceSlug, "client-connections"\)\n\s+if \(request\.headers\.get\("x-workspace-user"\) !== user\.id\) return Response\.json\(\{ error: "Your account changed\. Reload the page\." \}, \{ status: 409, headers \}\)\n\s+await requireRelationshipAccess\(access, relationshipId\)/, "panel, account, then this client, before anything is read")
    assert.match(connections, /readCurrentClientConnections\(workspace\.id, user\.id, relationshipId\),\s+listWorkspaceConnections\(workspace\.id\),/, "the same two reads as the Client Connections page narrowed to a client")
    assert.doesNotMatch(connections, /export async function (POST|PUT|PATCH|DELETE)/)

    const onboarding = source("app/api/workspaces/[workspaceSlug]/relationships/[relationshipId]/onboarding/route.ts")
    assert.match(onboarding, /await requireWorkspacePanel\(workspaceSlug, "onboarding"\)\n\s+if \(request\.headers\.get\("x-workspace-user"\) !== user\.id\)/)
    assert.match(onboarding, /if \(!relationship \|\| \(allowedRelationshipIds && !allowedRelationshipIds\.has\(relationshipId\)\)\) return Response\.json\(\{ error: "Client not found\." \}, \{ status: 404, headers \}\)/, "a client the person may not open is not found")
    assert.match(onboarding, /const sessionId = requested \?\? \(sessions\.length === 1 && !listed\.hasMore \? sessions\[0\]\.id : null\)/, "one session opens directly; several are listed for the person to choose, as the record page does")
    assert.match(onboarding, /if \(requested && !listed\.hasMore && !sessions\.some\(session => session\.id === requested\)\) return Response\.json\(\{ error: "Onboarding session not found\." \}, \{ status: 404, headers \}\)/, "a named session must be one the person is offered")
    assert.match(onboarding, /const data = startOnboardingDetailData\(\{/, "the same access-scoped loader as the record page")
    assert.match(onboarding, /canOpenCompleteClientSession: !fullyAllowedRelationshipIds \|\| fullyAllowedRelationshipIds\.has\(relationship\.id\),/)
    assert.match(onboarding, /const mayCopy = Boolean\(activity\.onboardingUrl\) && \(\(session\.status !== "archived" && activity\.canManage\) \|\| \(!session\.token_revoked_at && activity\.canOpenCompleteClientSession\)\)/, "the link is returned only where the record page shows or manages it")
    assert.doesNotMatch(onboarding, /export async function (POST|PUT|PATCH|DELETE)|session_token/, "read-only, and the raw token never leaves the loader")
    const record = source("app/[workspaceSlug]/onboarding/[relationshipId]/page.tsx")
    assert.match(record, /startOnboardingDetailData[^\n]* from "@\/lib\/onboarding\/staff-detail"/, "the record page reads through the same module")

    // @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
    const { onboardingAnswerText } = await import("../lib/onboarding/staff-detail-view.ts")
    assert.equal(onboardingAnswerText(["a", "b"]), "2 uploaded files")
    assert.equal(onboardingAnswerText(["a"]), "1 uploaded file")
    assert.equal(onboardingAnswerText("  Leeds "), "Leeds")
    assert.equal(onboardingAnswerText(""), "No answer provided")

    // The shared section read: one request however many places show it, nothing repeated while fresh, and a failed
    // later read keeps what was already shown.
    // @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
    const { createSectionRead } = await import("../lib/client-section-read.ts")
    const original = globalThis.fetch
    let calls = 0, fail = false
    globalThis.fetch = (async (_url: string, init: { headers: Record<string, string> }) => {
        calls++
        assert.equal(init.headers["x-workspace-user"], "user-1")
        return fail ? new Response(JSON.stringify({ error: "nope" }), { status: 503 }) : new Response(JSON.stringify({ value: calls }), { status: 200 })
    }) as unknown as typeof fetch
    try {
        const store = createSectionRead((_response: Response, body: { error?: string } | null) => body?.error ?? "failed")
        let notified = 0
        const stop = store.subscribe("k", () => { notified++ })
        await Promise.all([store.read("k", "/x", "user-1"), store.read("k", "/x", "user-1")])
        assert.equal(calls, 1, "two consumers share one request")
        assert.deepEqual(store.snapshot("k"), { data: { value: 1 }, error: null, loading: false })
        await store.read("k", "/x", "user-1")
        assert.equal(calls, 1, "a fresh answer is not read again")
        fail = true
        await store.read("k", "/x", "user-1", true)
        assert.equal(calls, 2)
        assert.deepEqual(store.snapshot("k"), { data: { value: 1 }, error: "nope", loading: false }, "what was shown stays shown when a later read fails")
        assert.ok(notified >= 3)
        stop()
    } finally { globalThis.fetch = original }
    const hook = source("components/relationships/useClientSection.ts")
    assert.doesNotMatch(hook + source("lib/client-section-read.ts"), /setInterval|setTimeout\(/, "nothing polls")
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
    assert.match(shell, /const drawerOpen = sidebarOpen && \(layout !== "today" \|\| sidebarHydrated\)/)
    assert.match(shell, /\$\{layout === "today" \? "hidden md:inline-flex" : "inline-flex"\}/, "on phones the bar replaces the top bar's sidebar button")
    assert.doesNotMatch(shell, /data-today-button/, "and the strip's Today button")
})

test("on a phone each bar item opens what it names, and the rest is one menu", () => {
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    const bar = shell.slice(shell.indexOf("{layout === \"today\" ? <PhoneBottomBar items={["), shell.indexOf("{creationNotice ?"))
    assert.match(bar, /key: "clients", label: "Clients", icon: <RelationshipsIcon \/>, disabled: !online, active: phoneBarClientsActive && !phoneMoreOpen, onSelect: \(\) => \{ setPhoneMoreOpen\(false\); openTodayDestination\(clientsHref\) \}/, "Clients opens the Clients page through the shell's opening rule, not a drawer")
    assert.doesNotMatch(bar, /toggleSidebar|setSidebarOpen|drawerOpen/, "nothing in the bar opens the sidebar")
    assert.match(shell, /const phoneBarClientsActive = activeRailPath === clientsHref \|\| activeRailPath\.startsWith\(`\$\{clientsHref\}\/`\)/, "Clients stays current on a client's own page")
    assert.match(shell, /const phoneBarRest = railDestinations\.filter\(\(item\) => item\.key !== "relationships" && item\.key !== "communications"\)/, "More holds exactly what the bar has no item for")
    assert.match(bar, /key: "more", label: "More", icon: <MoreIcon \/>, expanded: phoneMoreOpen, active: !phoneMoreOpen && phoneBarRest\.some\(\(item\) => item\.active\)/, "More reads as current while one of its destinations is in front")
    assert.match(bar, /<RailDestinationRow key=\{item\.key\} item=\{item\} onOpen=\{\(entry, event\) => \{ openRailDestination\(entry, event\); if \(!entry\.disabled\) setPhoneMoreOpen\(false\) \}\} \/>/, "its rows open through the same owner as the sidebar's")
    assert.match(bar, /onClick=\{\(\) => \{ goBack\(\); setPhoneMoreOpen\(false\) \}\} disabled=\{!canGoBack\}/, "the destination's own history keeps a place on a phone")
    assert.match(bar, /badge: phoneBarComms\.active \? undefined : <UnreadMessageCount count=\{communicationsUnreadCount\} loading=\{readProtocol === "device-v1" && !communicationsUnreadLoaded\} label="unread Communications messages" \/>/, "Comms and its count are as they were")
    // The sidebar is not a phone drawer in this layout, so what the drawer held has its own place.
    assert.match(shell, /`max-md:hidden md:left-0 md:top-0 md:h-dvh md:border-r/)
    assert.match(shell, /\{drawerOpen && layout !== "today" && <button data-workspace-sidebar-dismiss/, "no invisible dismiss surface is left over a phone's page")
    assert.match(shell, /\{layout === "today" \? <button ref=\{mobileSearchTriggerRef\} data-icon-button data-phone-search type="button"/, "search is in the top bar")
    assert.match(shell, /<ListActionMenu allowBelow label="Create something new"\s*\/\/ From md up a labelled button; on a phone the plus alone, beside search\./, "and so is New")
    assert.match(shell, /\{layout === "today" \? null : <div className="flex h-10 items-center border-b border-card-border pb-2 md:hidden">/, "the drawer's own search row belongs to the tabbed layout")
    const menu = source("components/workspace/PhoneBottomBar.tsx")
    assert.match(menu, /\{open \? <>[\s\S]*<button type="button" data-phone-bar-dismiss aria-label="Close menu" onClick=\{onCloseMenu\} className="absolute inset-x-0 bottom-full h-dvh /, "the menu and its dismiss surface are children of the bar, so they are hidden whenever the bar is")
    assert.match(menu, /const escape = \(event: KeyboardEvent\) => \{ if \(event\.key === "Escape" && !event\.isComposing\) onCloseMenu\(\) \}/)
    assert.match(menu, /const widened = \(\) => \{ if \(!phone\.matches\) onCloseMenu\(\) \}/, "it closes when the window stops being a phone")
})

test("a narrow client Overview is one list in reading order, and its property rows share one size", () => {
    const panel = source("components/workspace/NativeRelationshipsPanel.tsx")
    const detail = panel.slice(panel.indexOf("function ClientDetail("), panel.indexOf("function RelationshipDetail("))
    assert.match(detail, /const narrowColumn = "contents @4xl:flex @4xl:min-w-0 @4xl:flex-col"/, "below 56rem the two columns have no box of their own")
    assert.match(detail, /data-client-section="overview" className="flex flex-col gap-8 pt-5 @4xl:grid @4xl:grid-cols-\[minmax\(0,1fr\)_19rem\]/)
    const order = (pattern: RegExp) => { const match = detail.match(pattern); assert.ok(match, String(pattern)); return Number(match[1]) }
    const sequence = [
        order(/<section aria-label="Next up" className="order-(\d+) @4xl:order-none">/),
        order(/<section aria-label="Services" className="order-(\d+) @4xl:order-none">/),
        order(/<div className="order-(\d+) empty:hidden @4xl:order-none">\{parts\.contacts\}<\/div>/),
        order(/<div className="order-(\d+) flex flex-col @4xl:order-none">\s*<SectionHeading>Details<\/SectionHeading>/),
        order(/<div className="order-(\d+) @4xl:order-none"><SectionHeading>Notes<\/SectionHeading>/),
        order(/<div className="order-(\d+) @4xl:order-none"><SectionHeading>Activity<\/SectionHeading>/),
        order(/<section aria-label="Engagement" className="order-(\d+) @4xl:order-none">/),
        order(/<div className="order-(\d+) @4xl:order-none"><DetailDangerZone>/),
    ]
    assert.deepEqual(sequence, [...sequence].sort((a, b) => a - b), "work, services, contact, details, notes, activity, engagement, and the danger zone last")
    assert.equal(new Set(sequence).size, sequence.length)
    assert.match(detail, /<div className="order-1 @4xl:order-none"><RelationshipBackgroundFields compact part="fields" \/><\/div>\s*\{data\.context \? <ClientSummary context=\{data\.context\} \/> : null\}/, "narrow, the editable record follows who manages the client; wide, it leads as before")

    const fields = source("components/detail/DetailFields.tsx")
    assert.match(fields, /export const narrowPropertyGrid = "grid-cols-\[6rem_minmax\(0,1fr\)\]"/)
    assert.match(fields, /narrow \? "\[&>div\]:grid-cols-\[6rem_minmax\(0,1fr\)\] sm:\[&>div\]:grid-cols-\[6rem_minmax\(0,1fr\)\]"/, "the narrow list and hand-built rows share one label column")
    assert.match(fields, /export const touchPropertyRows = "max-sm:\[&>div\]:min-h-11 max-sm:\[&>div\]:items-center max-sm:\[&>div\]:py-0 max-sm:\[&>div>div\]:text-base"/)
    assert.match(source("components/relationships/ClientSummary.tsx"), /<DetailFields narrow className=\{touchPropertyRows\}>/)
    assert.match(source("components/relationships/RelationshipBackgroundEditor.tsx"), /<DetailFields narrow className=\{`\[&>div\]:py-0 \[&>div>div\]:-ml-1 \$\{touchPropertyRows\}`\}>/)
    const engagement = source("components/relationships/ClientEngagement.tsx")
    assert.match(engagement, /\{metrics \? <DetailFields narrow className=\{touchPropertyRows\}>/)
    assert.match(engagement, /className=\{`grid min-h-9 \$\{narrowPropertyGrid\} items-baseline gap-2 py-1\.5 text-sm \$\{touchPropertyRow\}`\}/)
    assert.match(engagement, /<div className="grid grid-cols-3 gap-x-4 sm:gap-x-8">/, "the three trends stay side by side on a phone")
    assert.match(source("components/relationships/RelationshipContactCards.tsx"), /\$\{narrowPropertyGrid\} items-center gap-2 rounded-md px-1 py-1\.5 text-left text-sm [^`]*\$\{touchPropertyRow\}`/)

    const header = source("components/relationships/ClientPageHeader.tsx")
    assert.match(header, /className=\{`\$\{panelTabStripClass\} max-sm:-mx-4 max-sm:gap-3\.5 max-sm:px-4`\}/, "on a phone the tab strip runs to the screen edges")
    assert.match(header, /\{tab\.shortLabel \? <><span className="sm:hidden">\{tab\.shortLabel\}<\/span><span className="max-sm:hidden">\{tab\.label\}<\/span><\/> : tab\.label\}/)
    assert.match(source("lib/client-page.ts"), /label: "Files and notes", shortLabel: "Files"/)

    const list = panel.slice(panel.indexOf("function ClientsTable("), panel.indexOf("function ClientDetail("))
    assert.match(list, /<Table ariaLabel="Clients" className="max-sm:\[&_thead\]:hidden /, "a phone's Clients list has no column headings")
    assert.match(list, /<span className="flex min-w-0 text-xs font-normal text-neutral-500 sm:hidden">\s*<span className="min-w-0 truncate">\{row\.businessName \?\? "No company saved"\}<\/span>\s*\{row\.openWork \? <span className="shrink-0 whitespace-pre"> · \{row\.openWork\} open<\/span> : null\}/, "its second line carries the business and the open work, and a long business gives way before the count")
    assert.match(list, /<TableCell numeric className="max-sm:hidden">\{row\.openWork \|\|/)
})
