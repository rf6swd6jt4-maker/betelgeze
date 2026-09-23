# Communications layout contract

Status: implementation candidate, awaiting physical-device and user acceptance. This is the intended behavior and maintenance boundary, not a declaration of a permanently verified UI. Preserve `app_speed.md` and the protected `app-alerts.md` contract. Release evidence is recorded separately below.

## Required experience

- Workspace top bar, workspace tabs and conversation header remain stationary during keyboard and draft changes.
- The messages and composer move only by the measured keyboard displacement. Composer growth consumes exactly its visible slot-height increase; it must not cause an extra whole-chat slide.
- An opening/closing animation travels from the current displayed position toward the measured endpoint. It never visits a remembered full-height layout because focus changed or the app resumed.
- Multiline drafts grow smoothly to the existing four-line mobile/seven-line desktop limit and scroll internally afterward. Reply and attachment trays use the same footer slot. The inner footer may be larger than its animated slot; the slot clips it and defines the visible boundary.
- Latest-following messages retain their gap above the visible composer slot. A reader above the latest message retains their content position relative to the bottom of the pane as available height changes; do not jump them to the latest message. Native touch scrolling and momentum own their position while interacting.
- Typing, selection handles, select-all, copy/paste, undo/redo, formatting, draft retention, quoting, media, read/unread and notification semantics remain unchanged. Desktop and reduced-motion sizing remain immediate.

## Ownership and maintenance

| Responsibility | Owner |
| --- | --- |
| Host viewport, actual focus and resident frame identity | `WorkspaceTopBarClient`; standalone portal uses `client-portal-composer-viewport` |
| Valid measured edge, focus/lifecycle cancellation, bounded late measurement | `createComposerViewportController` |
| Measured fixed-chrome correction before motion capture | `createWorkspaceVisualOrigin` |
| Guarded resting document-origin recovery | `createViewportOriginRecovery` |
| One clipped keyboard animation and atomic final geometry | `ChatMotionViewport` / `observeChatViewportMotion` |
| Multiline/reply/attachment slot sizing | `ComposerFooter`; editor measurement belongs to CodeMirror |
| Message content/viewport anchoring and native scroll ownership | `observeConversationLayout` |

Use these existing owners for future additions. Do not add another keyboard listener, footer keyboard transform, speculative focus/blur height, immediate document-scroll reset, animated iframe height, or timeout that restores a cached endpoint. Do not temporarily shrink the visible editor to measure it. No animation libraries, polling loops, new runtime dependencies or per-animation-frame JavaScript are introduced by this repair.

The compositor layer may temporarily keep a larger *internal* layout to avoid resizing the iframe every animation frame; its displayed position must follow the measured motion and its transient height/transform must be released. The controller must distinguish that applied layout from its requested endpoint. A departed owner cannot finish an obsolete request; the current valid measurement repairs geometry after retirement. Duplicate requests for a still-owned endpoint must not restart animation. A revised endpoint after the animation deadline must still preserve an active touch/momentum gesture. The message observer must reconcile any height/content change before a queued scroll frame remembers a new baseline; WebKit may run that frame before ResizeObserver. Otherwise a multiline transition can silently consume part of the required scroll correction. This uses the existing scroll frame, with no new animation loop, and continues to yield during touch/momentum. Store anchor positions in transform-free layout coordinates, including positioned-parent borders; separate animated screen-bounds reads must not become a content-growth delta. Current message rows share the pane scrolling context without an intervening scroller.

Once device acceptance is recorded, treat these boundaries as stable. A future change to them needs a concrete defect or requirement, a reproducing regression case, the full relevant checks and a renewed affected-device check. Feature additions should use the contract without altering it incidentally.

## Acceptance and release evidence

Base: `1dc8f19b31077b5714941929a8851577b7e534cd`. Application-only repair; no schema, client records, messages, stored files, credentials or delivery operations are modified for validation. Fixtures use synthetic local data and block external requests.

Automated coverage must use the production controller, motion layer, composer, editor and message observer together, including native and resident iframe layouts. Measure intermediate frames as well as final positions. Relative message/composer gaps use transform-free local coordinates: separate screen-rectangle reads can sample different instants of a shared compositor animation. This is a measurement correction, not a relaxed tolerance. The composed fixture uses production React components and helpers with representative shell wiring, not the authenticated WorkspaceTopBarClient application. Cover endpoint and continuous keyboard changes, rapid reopen, unchanged short viewport at blur/resume, departure during motion, revised endpoints during touch/momentum, multiline growth/shrink, reply/attachment height changes, history anchoring, selection, reduced motion and desktop.

Before calling this baseline verified, record the tested release/device/browser and results for:

| Check | Acceptance status |
| --- | --- |
| Focused and full repository tests, changed-file lint, production build | Local checks passed: 1,295 tests, foundation lint/history/whitespace gate, webpack production build; hosted candidate checks pending |
| Real-component Chromium and WebKit regression matrix | Local foundation runner passed 120 checks per engine, including 24 mobile chat cases, 2 reduced-motion cases and 1 desktop case per engine; hosted candidate checks pending |
| Exact production commit and terminal deployment status | Pending deployment |
| Physical iPhone Safari and Home Screen mode | Pending user test |
| Physical Android Chrome | Pending device check |
| Authenticated desktop interactions | Pending user test |
| Ordinary working-day stability | Not yet established |

Physical checks: open/close and rapidly reopen the keyboard; type/delete through the line limit; select and move handles in long drafts; add/remove reply and attachment previews; switch emoji/dictation keyboards; scroll history during keyboard motion; switch conversations and workspace tabs; background/return, lock/unlock, rotate, and repeat in browser and installed modes. Use an isolated test conversation for write actions; do not send messages to real clients solely to validate layout.

Rollback is application-only: revert this repair to the base revision without any database or storage cleanup. That restores the known earlier keyboard defect, so prefer a narrowly verified forward fix when possible. Never erase drafts or message history to reset UI geometry.
