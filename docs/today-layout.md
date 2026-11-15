# Today layout

The redesigned workspace shell: a **Today column** (your queue and, for owners and admins, what needs attention), a
**work area** showing what you opened, and the **client context** beside it, with no visible tab strip. It is selected
per workspace by `WORKSPACE_TODAY_LAYOUT` (see `.env.example` and `lib/workspace-layout.ts`); everyone else keeps the
tabbed shell. Mockup: https://claude.ai/artifact/TE7Yan13qkzgMzDv2f37Rn

## Principle: change what surrounds the work area, not how it works

Measured speed (`docs/performance-baseline/shell-revamp-baseline-2026-11-15.md`) comes from the shell's resident tab
model: up to eight destinations stay mounted, so returning to one is a 30-160 ms p95 switch instead of a 1.3-2.6 s
first load. The Today layout keeps that model and hides only its strip:

- Opening anything from the Today column, a link or the context panel goes through the existing `openWorkspaceTab`.
  An already-resident destination is re-activated (memory switch); a new one becomes a hidden resident tab.
- Draft departure checks, history, scroll and filters per destination, native panel caching and the context panel are
  unchanged, because they belong to the same owners as before.
- The Today column reads the queue through the shell's existing `nativeCache` entry for `/<workspace>/queue`, so it
  shares data and in-flight requests with the Queue panel instead of fetching twice. Needs attention uses its own
  authenticated GET route (`workspace_needs_attention`, 1.6-5 ms); it loads once per shell and refreshes when the window
  returns to the foreground, at most once a minute. No polling, subscriptions or hidden-tab work are added.

## Slices

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
5. **Measure and roll out.** Pilot one workspace, compare its `workspace_interaction_metrics` against the baseline with the
   same query, then widen.
