# Today layout

The redesigned workspace shell: a **client rail** on the left (Today, then your clients as initials, then the other
destinations), a **work area** showing what you opened, and **Comms docked on the right** when you ask for it, with no
visible tab strip. It is selected per workspace by `WORKSPACE_TODAY_LAYOUT` (see `.env.example` and
`lib/workspace-layout.ts`); everyone else keeps the tabbed shell. Mockups: the first cockpit
(https://claude.ai/artifact/TE7Yan13qkzgMzDv2f37Rn) and the client rail that replaced its Today column
(https://claude.ai/artifact/XK4YHnSgRiqYViDYQPjUhK).

## Principle: change what surrounds the work area, not how it works

Measured speed (`docs/performance-baseline/shell-revamp-baseline-2026-11-15.md`) comes from the shell's resident tab
model: up to eight destinations stay mounted, so returning to one is a 30-160 ms p95 switch instead of a 1.3-2.6 s
first load. The Today layout keeps that model and hides only its strip:

- Opening anything from the rail, the Today page, a link or the client column goes through the shell's existing
  owners (`openWorkspaceTab`, `switchTab`, `navigateActiveTab`). An already-resident destination is re-activated
  (memory switch); a new one becomes a hidden resident tab.
- Draft departure checks, history, scroll and filters per destination and native panel caching are unchanged, because
  they belong to the same owners as before.

## Client rail (built on `client-rail`, 16 November 2026)

Decided with the person after the declutter passes: the same thing was reachable from too many buttons, and the screen
had no single organising idea. Now you work on a client, and each thing has one way in.

- **Rail** (`components/workspace/ClientRail.tsx`). It takes the sidebar's place in the Today layout, in the same frosted
  box. From `md` up it is 4rem of initials; with a mouse it widens to 17rem **over** the page on hover (CSS only:
  `--workspace-sidebar-width` does not change, so nothing moves and the shell does not re-render), and the top bar's
  sidebar toggle pins it open, which does move the page as before. Touch tablets have no hover, so they keep the narrow
  rail until pinned. Below `md` it is the existing slide-in drawer with names. Order: **Today**; clients; then Library,
  Staff and Settings, with Relationships, Onboarding, Client Connections, Onboarding Builder and Admin behind **More**
  (the destination in front of the person is never hidden behind it). A find box appears from nine clients.
- **Client list read** (`GET /api/workspaces/<slug>/client-rail`, `lib/client-rail.ts`). Three columns of current
  (non-archived) relationships the person may open, in name order, at most 60; a longer list says so and links to
  Relationships. It follows `relationships_workspace_person_idx` and stops after the limit, instead of the
  Relationships panel's whole list with its service, work, channel and creator lookups. Members whose access is scoped
  get only their relationships; people who cannot open Relationships get no names. One read per shell, a quiet re-read
  when the window returns after five minutes, and one when a relationship is created. No polling. Legacy clients that
  have no relationship record are not in the rail; they remain in Relationships.
- **Opening rule.** A client opens its relationship page through `openWorkspaceTab`, so each client is its own resident
  destination. A rail destination (`openTodayDestination`) is a place to return to: if you are already in it you go to
  its first page; if it is open elsewhere you switch back to it as you left it; otherwise it opens as a new resident.
- **Today is a page.** The queue destination, titled Today, is the same `PersonalWorkQueue` as before, so nothing it
  shows is lost. For owners and admins `TodaySide` sits beside it (below it when the work area is narrower than 56rem):
  Needs attention (at most four rows, identical items merged) and the Team queue, which always starts closed and is read
  only when opened. The Today column, its phone sheet, the "Still open" list and the Open queue / Open staff buttons are
  gone. Needs attention is read when Today is shown, at most once a minute, not at every shell start.
- **The client's own page** carries what the client column showed beside it (`ClientSummary`): email and phone with
  copy, manager and source as `DetailFields`, the lifecycle stage as a header label, then Chat, Onboarding, Fulfilment
  and Client Connections. It renders the context the page already loads; no request is added.
- **The client column stays beside records that belong to a client** (work items, assets, notes, onboarding), in its
  dense form, and is not shown on the client's own page. It has no hide control in this layout. Its Chat is one button.
- **Comms is a docked panel**, flush to the right edge under the top bar, `--workspace-dock-width` wide. `Comms` in the
  top bar opens the conversation list; Chat on a client's page or in the client column opens that client's
  conversation, which is on screen only beside that client's own pages. While the panel is on screen the work area ends
  where it begins (`body[data-workspace-dock="shown"]`), so framed pages are no longer overlapped, and the client
  column gives way to it. There is no "Open full view" and, where the panel is offered, no Communications entry in the
  rail. Below `lg` the panel is not offered and Communications is the full destination, reached from the rail.
- **Unchanged here:** the docked frame, its owner (`DockedCommunications`), when it is named as on screen, the read
  rule and every Communications file. Only where its buttons live and where it sits changed. `app-alerts.md` (entry of
  16 November 2026) and `app_speed.md` section 7 describe the panel; their wording was updated with the person's
  permission ("Ship, update contracts"), with no rule change.
- **Not built:** the phone bottom bar from the mockup. It changes the space the phone chat lives in
  (`html[data-workspace-viewport-locked]` geometry), which `app-alerts.md` protects, so it needs explicit permission
  and a signed-in device check. Phones use the drawer. Per-client unread marks on the rail are also not built: the
  shell's unread owner exposes only a total, and widening it is an alerts change.
- **Speed.** Launch in this layout adds the client list read (above) and no longer reads Needs attention unless Today is
  shown. The rail adds no subscription or timer, and hovering it runs no script. Nothing was measured signed in; the
  pilot comparison in slice 5 still applies.
- **Checked:** unit tests (`tests/today-layout.test.ts`), and `scripts/serve-client-rail-fixture.mjs`, which runs the
  real rail, Today sections, client summary and client column with synthetic data. **Not checked:** the signed-in app,
  WebKit, real data volumes, a phone.

## History: the slices before the client rail

Kept as the record of how the layout was built. The Today column, its sheet, "Still open" and the Context / Chat switch
described below were replaced by the section above; the resident model, the open-item limit, the docked frame and its
owner, the Team read and the declutter passes still apply.


1. **Frame and Today column.** From `lg` up: hide the tabs (the strip stays for its context-panel controls), add the Today column between the sidebar
   and the work area, open items through `openWorkspaceTab`, mark the active item. Below `lg` the layout keeps the tab
   strip and no column (phones are slice 2). Nothing changes when the switch is off.
2. **Phones and tablets.** Below `lg` the tabs are hidden too, and a **Today** button in the strip opens the same
   column as a left `SideDrawer` sheet; choosing an item closes the sheet and opens it through `openWorkspaceTab`.
   The sheet opens by itself once at launch when the shell starts on the workspace home or queue. It mounts only while
   open (no fetches while closed), closes on navigation, tab switches and the other drawers, and reuses Needs
   attention and the queue cache when reopened within a minute.
3. **Open-item limit and finish.** Built on `today-layout-finish`.
   - *Limit.* With eight destinations open, opening a ninth drops the least recently used destination that is not
     mounted (`workspaceTabToEvict` in `lib/workspace-tabs.ts`) instead of replacing the one in front of the person.
     Mounted (resident) and active destinations are never candidates: an unmounted destination has no live owner and
     already passed its departure check when it left residency, so no unsaved draft can be dropped. The eviction rides
     the same `prepareNativeLeave` check and commit as the open, and is re-validated inside the commit; if the plan no
     longer holds, nothing happens. The tabbed layout keeps its old rule because its tabs are visible and closable.
   - *Column.* Rows use `ListCompactItem`: status and waiting time or effort, a title of up to two lines, then the
     client and deadline. The open record carries `aria-current` and the selection marker. Needs attention collapses
     (remembered per person and workspace on the device), shows its total as a red count and links to the rest. First
     loads show placeholder rows. Relative wording comes from `lib/today-column.ts` and its clock advances only with a
     Needs attention read, so no timer is added.
   - *Still open.* The other open destinations, most recently used first (at most five), so hidden tabs stay
     reachable. Choosing one re-activates it through `openWorkspaceTab`: a memory switch, no request.
   - *Work-area bar.* The strip shows the current destination's title and its loading mark where the tabs were.
   - Speed: no request, subscription, timer or resident owner is added. The column still makes one shared queue read
     and one Needs attention read; "Still open" and the title render from shell state already in memory.
4. **Comms in the client column and drawer.** Built on `today-layout-finish`; desktop width only. Authorized in
   `app-alerts.md` (docked chat, 15 November 2026) and `app_speed.md` section 7.
   - The client column gains a Context / Chat switch (`SegmentedSwitch`). Chat docks that client's conversation; the top
     bar's Comms button opens the conversation list as a floating drawer over the same column position.
   - Both are one `DockedCommunications` frame showing the existing Communications page at its phone layout, so reads,
     unread counts, drafts, sends and alerts run the page's own code. At most one dock exists. Nothing loads until it is
     asked for.
   - Returning to Context hides the dock without unloading it. Closing it, docking another client or opening the drawer
     first runs the frame's departure check; a chat that cannot confirm its work is saved stays, with a notice.
   - Record links inside the dock open in the work area through `openWorkspaceTab`. If the docked page navigates away
     from Communications, that destination opens in the work area and the dock returns to its chat.
   - Below `lg` there is no dock: Communications stays the full view from the sidebar.
   - The docked chat is wider than the context reference on wider windows (`--workspace-dock-width`: 20rem, 24rem from
     1280px, 26rem from 1440px, 30rem from 1680px), and native panels reserve that width while it shows. Legacy framed
     pages still reserve 20rem, so there the chat overlaps the page's right edge by the difference.
   - Not verified without a signed-in session: the real page inside the dock (layout at 20rem, composer, realtime),
     WebKit, and real read and alert behaviour. Check these in the pilot before widening.
   - *Mine / Team (added on `today-team-queue`).* Owners and admins get a `SegmentedSwitch` above the queue. Team shows
     other people's ready work with the owner's name, from `read_team_work_queue`: for each other member it calls the
     existing personal queue read and keeps that person's first four items and ready count, so Team always matches what
     each person sees, in their order. People take turns in the list and work in progress comes first. Bounded to 25
     members and 100 rows; descriptions are not sent. The read costs one personal queue read per other member, so it
     runs only when Team is chosen (never at shell start; the switch always opens on Mine) and is reused for a minute.
     Until the migration `20261115190000_team_work_queue.sql` is applied the Team view says "Needs a database update".
     `scripts/validate-team-queue-full-schema.mjs` checks it against every committed migration in CI.
   - *Team read on production (15 November 2026).* The migration was applied through the Supabase SQL Editor after a
     read-only check that the function was absent and its dependencies present. Installed as security definer,
     executable by `service_role` only. Measured with `explain analyze` for the pilot owner in the pilot workspace
     (7 memberships): Team read 309-341 ms execution over four runs; one personal queue read 49 ms; the membership
     count 0.15 ms. So the cost is about one personal read per other member, as designed. At the time it returned 2
     people with 7 ready items, at most 4 per person, not truncated. These are database execution times for one
     workspace at one moment: they exclude network, authentication and rendering, and are not a latency guarantee.
     The cost grows with members (bounded at 25) and with each person's queue. Not measured: the request end to end
     in the signed-in app.
   - *Declutter, pass 1 (`today-declutter`).* Decided from a screenshot of the real pilot screen, where three dense
     columns had equal weight. (a) From `lg` up the emptied tab strip row is removed (`display: none`), its height goes
     to the work area and the client column, and the context toggle moves to the top bar; below `lg` the strip stays for
     the Today and context buttons. The work-area title is gone at desktop width because every page states its own.
     (b) The queue is the first section and Needs attention the second, capped at four rows; identical items (same
     kind, title and client) merge into one row with a count that opens the full list. (c) The work item's
     Dependencies field is top-aligned: as an inline-block it aligned by its last line, so a wrapped list was lifted
     over the Parent row. No request, timer or resident owner changes; removing the strip removes one fixed layer.
   - *Declutter, pass 2: top bar (`today-top-bar`).* In the Today layout the five create icons become one `New` menu
     (`ListActionMenu` with a labelled trigger; each entry keeps its own permission and the menu is absent for someone
     who can create nothing), and presence shows three people, connected first, with the rest as a `+N` count whose
     tooltip names them. Back, forward, reload, search, Comms, the context toggle and the account menu are unchanged.
     The tabbed layout keeps its icon row and full presence. No request or subscription changes: the same presence
     roster is rendered shorter.
   - *Declutter, pass 3: client column (`today-client-column`).* `ShellRelationshipContextPanel` takes `dense`, set
     only by the Today layout: the "Relationship context" label and record id are gone, contact values lose their
     per-value labels, and manager and services are one line each (service and stage left, owner right; avatar only
     for service owners). In the fixture this took a three-service client from eleven lines to four. The same data is
     rendered; no request changes. The tabbed layout and standalone pages are unchanged.
   - *Declutter, pass 4: small noise (`today-quiet-details`).* In the Today layout's native panels the record
     reference line, the "Updated" stamp and the icon beside each field label are hidden by CSS; the reference is the
     title's tooltip. Everywhere, autosaving text fields no longer show an idle "saves automatically" note: the line
     appears only for an unsaved change, a save in flight, a confirmed save or a failure, with its height reserved.
     Pending and error wording is unchanged, so nothing is reported as saved earlier than before.
5. **Measure and roll out.** Pilot one workspace, compare its `workspace_interaction_metrics` against the baseline with the
   same query, then widen.
