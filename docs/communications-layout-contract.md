# Communications layout contract

Status: mobile resident rebuild candidate; physical-device and user acceptance pending. This replaces the mobile staff layout introduced at `93e7bcca`. Preserve `app_speed.md` and the protected `app-alerts.md` policy. A passing fixture, build or deployment does not establish physical keyboard behaviour.

## Required experience

- Workspace header, tabs and conversation header keep their screen position during keyboard and draft changes.
- The composer occupies the bottom of the usable visual viewport. Its complete measured height determines the message pane's remaining space; no independent whole-chat slide or delayed footer resize applies in the mobile resident surface.
- Following latest retains the message/composer gap. Reading older history retains a message anchor relative to the bottom of the pane across height changes. Native touch scrolling/momentum owns scroll position during interaction; no delayed correction replays afterward.
- Long drafts grow to the existing line limit, then scroll internally. On short/landscape viewports the editor's visible height is further bounded to retain Send. Reply, attachment, error and sticker accessories scroll within their own bounded region. Attachment rows support horizontal scrolling. A focused editor keeps keyboard focus on Send; IME composition cannot accidentally submit.
- Hidden modes/tabs retain drafts and loaded conversation state but cannot acquire focus, display portal menus, continue gallery playback or finish obsolete hold gestures.
- Existing authorization, message ordering, idempotent sends, pending mutations, encrypted storage, read acknowledgements, exact active-chat visibility and notification semantics remain unchanged.

## Ownership

| Responsibility | Owner |
| --- | --- |
| Resident mobile Comms tab, scoped cache and shell navigation | `NativeCommunicationsTab`, `WorkspaceRecordCache`, `WorkspaceNavigationProvider` |
| Active-mode bootstrap | Existing authorized client sync / native conversations GET endpoints |
| Mobile viewport geometry | `observeMobileWorkspaceViewport` in the persistent shell |
| Messages and composer layout | Normal flex layout within `ChatMotionViewport` |
| Bounded accessories and editor | `ComposerFooter`, container-relative CSS, CodeMirror |
| Message anchoring and touch/momentum ownership | `observeConversationLayout` |
| Drafts/messages/uploads/reconnect | Existing Communications owners, retained across local selections |
| Read/unread and alerts | Existing `useConversationRead`, activity/summary owners and `app-alerts.md` |

The mobile renderer is selected before its resident document mounts and retained through orientation/width changes. Desktop-opened iframe tabs and client portals retain their existing path. Loading a mobile Comms tab does not also mount a Comms iframe. Native panel readiness follows mounted real mode content and visible paint, not just a resolved bootstrap request. Local selections update only their tab URL; hidden panels cannot overwrite the active browser URL. Explicit shell navigation is fenced by existing departure/current-source checks.

Each resident Comms tab retains its own Realtime transport, preserving the former iframe isolation and exact broadcast topics. It shares the existing authentication owner instead of creating more GoTrue instances. Disposal releases its channels/socket. The migration adds no subscription per keyboard event and never suffixes private topics or changes notification policy.

## Geometry

All mobile geometry uses layout-viewport CSS pixels:

- `origin = visualViewport.offsetTop`
- `usable height = visualViewport.height`
- header top = origin
- tabs top = origin + measured header height
- panel top = origin + measured header height + measured tabs height
- panel height = usable height - measured header height - measured tabs height

The origin is never added to available height. No accumulating correction from the previous header rectangle applies. Focus/blur never predicts a keyboard size. Invalid/zoom samples retain usable geometry; without an initial valid sample the mobile owner does not claim ownership. Viewport events apply current geometry immediately and allow one next-frame reread; there is no animation or polling loop, cached endpoint replay, or document-scroll reset.

The legacy geometry/controller is suspended while this owner is active. The mobile chat does not subscribe to legacy synthetic motion. Composer sizing is natural layout; container units bound it to the actual available space below the chat header and pinned message, without a second JavaScript height owner. The existing message observer receives an atomic pre/post geometry notification and retains its interaction guards.

## Validation and release

Base: `93e7bcca704425839845e8471ad1e1b33c959aeb`. Application-only candidate; no migrations, production messages, uploads, credentials, records or provider operations are part of validation.

Evidence is recorded in `docs/mobile-comms-rebuild-validation.md`. It must distinguish:

1. unit/source checks and scoped lint;
2. production build;
3. synthetic Chromium/WebKit geometry, native-host lifecycle and reading fixtures;
4. candidate hosted CI and terminal production deployment;
5. authenticated and physical-device checks.

Phone acceptance: first and repeated keyboard open/close; immediate typing; rapid close/reopen; emoji/dictation; long draft selection, copy/paste/undo; reply/attachment/sticker growth; portrait/landscape; history and momentum during keyboard movement; media load and gallery dismissal; conversation/mode/workspace switching; background/return and lock/unlock; offline retry. Cover physical iPhone Safari and Home Screen app and physical Android Chrome/installed mode equally. Use an isolated test conversation for writes. Desktop regression checks remain required.

Do not label this baseline permanently verified or frozen before device acceptance and normal working-day use. User approval to deploy this candidate is for their phone test, not proof that the phone checks have passed.

Rollback: application-only revert to the base, preserving all drafts, cache isolation, pending/accepted messages and history. No database or storage cleanup. The earlier mobile keyboard defects return with that rollback; record that limitation rather than calling it a verified baseline.
