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

1. **Frame and Today column (this slice).** From `lg` up: hide the tabs (the strip stays for its context-panel controls), add the Today column between the sidebar
   and the work area, open items through `openWorkspaceTab`, mark the active item. Below `lg` the layout keeps the tab
   strip and no column (phones are slice 2). Nothing changes when the switch is off.
2. **Phones and tablets.** The Today column as the default screen with the work area pushed over it; back returns.
3. **Resident limit.** Replace the "replace the active tab when eight are open" rule with least-recently-used eviction
   that never evicts a destination with unsaved drafts.
4. **Comms in the context column and drawer.** Changes when messages count as read; needs the user's explicit
   permission under `app-alerts.md` before any work starts.
5. **Measure and roll out.** Pilot one workspace, compare its `workspace_interaction_metrics` against the baseline with the
   same query, then widen.
