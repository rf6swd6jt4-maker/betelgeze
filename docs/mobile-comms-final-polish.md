# Final mobile Comms UI polish — 24 September 2026

The user requested one last UI audit and deployment before the separate realtime
update workstream. Base: `df02213007da16d670930cc107e45daa1f997c85` (production).
The isolated release worktree preserves the unrelated primary checkout.

## Changes and reproduced failures

- Reaction rows now wrap inside the message pane. A synthetic 28-reaction Team
  row previously measured 1120px inside a 366px pane. Sticker reaction stacks now
  contribute height instead of covering following content.
- Reactions follow the message's reply/edit dimming. Visually disabled message
  controls cannot be reached with the keyboard while the composer action owns
  interaction. The selected quote remains selectable.
- Removing an edit target or confirming a private-chat clear restores the draft
  saved before editing. Cancelling a clear leaves the edit intact.
- Late action errors and composer cleanup are scoped to a particular chat visit,
  including A → B → A. Existing mutation requests and reconciliation still finish.
- Denied optional recent-emoji storage no longer prevents submitting a reaction.
  Retiring the custom emoji form clears its previous invalid entry and error.
- A gallery that loses its pointer capture retires the interrupted swipe and
  returns to its selected item; a late pointer-up cannot advance it.
- Chat controls, pinned previews, message content, composer and floating jump
  control avoid landscape side cutouts. Popup placement also excludes safe edges,
  accounting for edges already excluded by a keyboard or panned visual viewport.
  Ordinary zero-inset mobile and desktop spacing is preserved.
- Participant dialogs close when their owning chat is inactive; an old save
  cannot close or put an error into a later dialog session. The membership write
  and its refresh are unchanged.
- Client portal dialogs reject stale reads after reopen/update, serialize their
  pending form actions, retain failed input, wrap long labels, and close on chat
  departure. Existing API payloads and server behavior are unchanged.
- Cancelling pending voice playback no longer reports an unavailable recording.
  The seek control is exposed to assistive technology, indicates keyboard focus,
  and stays disabled when duration is unknown. Actual playback failures remain
  visible and retryable.

## Owner and performance boundaries

The composer focus, composer sizing, mobile surface, viewport, header-positioning,
message motion and message-pane resize owners are byte-unchanged from the approved
release. No browser-specific focus branch or additional correction is introduced.
The protected read/visibility/activity hooks, subscriptions, update coordinator,
read/unread/receipt policy, offline transport, routes and schema are unchanged.
Visual geometry still goes through the existing layout/scroll owners.

There are no new startup requests, pollers, subscriptions or animation loops.
Popup safe-area measurement runs in its existing placement callback. Request
fences are constant-size local state. Reactions continue rendering the same
records. The new regressions operate on loopback-only synthetic data; the small
fixture roster change exposes manager controls without any real permissions.
These observations support a bounded regression assessment, not a production
latency or battery benchmark.

## Audited interaction/state matrix

| Surface | States and interactions checked |
| --- | --- |
| Conversation | Empty/short/history, first and last message, entering/leaving/returning, interrupted navigation, retained editor/draft, portrait/landscape/desktop, reduced motion |
| Composer | Focus, keyboard geometry, multiline, selection, reply/quote, edit/cancel/save/failure, attachment add/remove, sticker tray, pending queue completion |
| Message elements | Incoming/outgoing, day/read metadata, quote preview, pin/unpin, jump, reply/edit spotlight, normal/sticker reactions, storage-denied custom emoji |
| Actions | Hold/context menu, keyboard traversal, copy, reaction/replacement/failure, delete/cancel/failure, private clear/cancel, late results after chat switches |
| Media | Attachment removal, image gallery focus/close, interrupted swipe and subsequent swipe, native video-control traversal, voice seeking/cancellation/error/retry |
| Header dialogs | Roster open/close/focus, stale save success/failure, inactive-owner cleanup, portal reopen/load/save races, duplicate submission, long title |
| Geometry | Header/composer containment, history anchors, shell coverage, empty prompt, small viewport popup clamp, simulated top/bottom/left/right safe areas |

## Validation and limits

- 1,324 repository tests; scoped lint, whitespace and migration-history gate.
- Production webpack build using synthetic environment values.
- Foundation matrix: 223 cases per engine in Chromium and WebKit.
- Actual-component interaction matrix: 88 cases per engine (20 routine actions,
  16 interrupted actions, 12 empty/short-chat, 10 final action cases, 4 voice,
  6 portal, 8 popup/gallery/roster and 12 safe-area cases).
- `node scripts/browser/run-comms-polish.mjs` now runs the action matrix in CI,
  alongside the foundation matrix, for each browser engine.
- A 390×844 rendered preview was inspected for opaque coverage, message actions,
  quote dimming, reactions, retained header and composer. The real desktop app was
  observed without altering its open conversation or existing draft.

The first full test run caught reuse of a retired jump-button marker. The new
safe-area hook uses a distinct marker; the original regression remains intact.
The voice fixture was made deterministic because `preload=none` is only a hint:
local blob metadata may already be loaded. It now explicitly exercises unknown
and known duration instead of racing the browser's metadata timing.

These are code, synthetic engine and rendered preview checks. Physical iPhone
Safari/PWA, physical Android Chrome/PWA, native emoji/file pickers, actual provider
operations and sustained production sessions require separate observation. No
real messages, uploads, membership changes or portal actions were used for tests.
No finite matrix establishes that every possible device/state combination is free
of defects.

## Deferred update/data findings

Client pinned-message navigation cannot currently retrieve an original outside
its loaded history; Team has a targeted path. That history/reconciliation work
is recorded for the next Comms update pass. The earlier initial-read recheck
limitation recorded in `mobile-comms-fullscreen-release.md` also remains open.
This UI release does not claim either is fixed.

## Rollout and rollback

Validate the exact candidate on the `codex/` branch before advancing `main` through
the existing Vercel integration. Record final commit, hosted CI and terminal
production deployment separately. Public HTTP smoke checks are not authenticated
mobile workflow evidence. Rollback is an application-only revert to the approved
`df022130` UI, preserving messages, drafts, permissions, storage and migrations.
