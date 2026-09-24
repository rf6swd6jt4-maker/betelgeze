# Local v6: motion, coverage and chat actions

Local candidate only. No deployment, backend or production-data changes.

## Scope and preserved baseline

The user reported promising physical behaviour in v5 and requested smoother
motion, opaque coverage and reliable action UI on Safari and Android browsers.
V6 retains the accepted composer focus, native selection and viewport/header
geometry. Protected file hashes are in
`/private/tmp/mobile-comms-displacement/polish-v6-protected.sha256`.
These include the composer, pointer-focus helper, footer, viewport helper and
protected read hook/predicate. Navigation race handling in the surface changes;
its viewport calculations and focus handling do not.

The most recent saved v5 phone trace contains only 2.347 seconds on the list.
It is not evidence of keyboard motion. The user's positive physical report and
the synthetic measurements below are separate forms of evidence.

## Changes

- Keyboard presentation uses a bounded 260ms ease-out. Endpoint revisions
  preserve current position and velocity against the original deadline;
  one-pixel reversals do not continually restart it. Genuine reversals start
  from current paint. Boundary recovery lasts 160ms. Reduced-motion settings
  still use natural layout.
- Width changes retire temporary old-width geometry, including during native
  scrolling, before resuming normal presentation. No focus or viewport-size
  predictions are introduced.
- While the chat is open or dismissing the keyboard, shell groups have zero
  opacity as well as hidden visibility. Descendants cannot override the group
  coverage. Horizontal entrance/exit still reveals the retained list normally.
- Interrupted navigation starts from its current painted transform. Obsolete
  fulfilled animation callbacks cannot complete a newer transition. Temporary
  compositor hints are removed on completion and cleanup.
- Cancelling a quote can enlarge the pane and make the browser clamp scrollTop
  before ResizeObserver runs. The existing scroll owner now applies the height
  delta to its remembered offset once. Native gesture/momentum guards remain.
- Custom emoji, roster and gallery focus use preventScroll. Modal keyboard
  traversal remains inside the dialog across browser Tab-order differences.

The preview now answers synthetic reaction requests with the real response
shape, returns the correct synthetic pin shape and keeps a sent local attachment
URL alive after clearing its upload thumbnail. These fixes make actual action
components testable; they are not changes to production API delivery or syncing.

## Performance and contracts

No new requests, subscriptions, history fetches, row listeners or JavaScript
animation-frame loop are added. Motion continues on a shared compositor layer
below the fixed header. Curve derivatives are calculated only on measured
endpoint changes; one clip ResizeObserver handles width changes. The existing
message observer remains the sole scroll writer.

The alert/read contract and mutation transport are unchanged. Tests may reject
or delay the preview's in-memory responses to inspect UI recovery; that does not
establish multi-device syncing or provider reliability. No production speed
claim follows from this synthetic production-mode React fixture.

## Phone review

Open `http://192.168.0.108:3107/?v=6` on the Mac's Wi-Fi and confirm the label
**Local v6 · Record test**. The optional recorder is numeric-only and capped at
45 seconds. Its build identity is `comms-polish-v6`.

Check keyboard open/close and quick reversal while at latest and in history;
long-press selection and multiline drafts; quote/reply cancellation, emoji
reactions, pinning, editing/deleting own messages, attachments and gallery;
Back/reopen and rotation. Header, draft and message position should remain
stable, and no app-shell frame should flash through an open chat.

Physical iPhone Safari/Home Screen and physical Android Chrome/installed-mode
acceptance remain separate. WebKit/Chromium fixtures exercise real DOM, animation
and scroll bounds but cannot prove native keyboard compositor timing. LAN HTTP
also does not establish secure installed-PWA parity. Deployment follows user
approval of this local candidate.

## Validation

- Repository suite: 1,324/1,324 passed.
- Foundation matrix: 218/218 Chromium and 218/218 WebKit passed, including
  mobile/desktop/reduced motion, resident/iframe, drafts, departure and layout.
- Motion regressions: 29/29 in each engine. The measured velocity across an
  endpoint revision remained -1.32958984375px/ms on both sides with zero position
  discontinuity. Restoring only the old restart-easing strategy fails this
  assertion in both engines; this is a strategy control, not a complete v5 run.
- Coverage regressions: 15/15 in each engine. The previous candidate failed the
  three added cases for visible descendants and interrupted navigation.
- Natural accessory shrink: two cases per engine, both native and iframe mobile
  surface ownership. The native scroll clamp occurs before correction. The new
  observer preserves the 12px history gap; restoring the old line adds 29px of
  displacement. Existing touch and momentum tests also passed.

Artifacts live in `/private/tmp/mobile-comms-displacement/`:
`polish-v6-unit-final.log`, `polish-v6-browser-final.log`,
`motion-v6-regressions.json`, `motion-v6-restart-easing-control.json`,
`v6-coverage-fixed.json`, and `accessory-clamp-regression.json`.
The full foundation report is `browser-results/foundations.json`.

- Actual Team/Client action suite: 20/20 Chromium and 20/20 WebKit passed, with
  no page errors or external requests. Covers delayed/rejected reactions,
  edit and delete success/failure/cancellation, reply/quote and history anchors,
  editor identity/draft retention, keyboard text selection, pin/unpin, bounded
  menus, roster/gallery focus, local attachments, sticker tray open/close and
  departure. Gallery video-origin Tab remains uncanceled for native controls;
  root and application-button traversal stays contained. Provider sticker
  conversion, native pickers and native video shadow controls are not simulated.
- Final `next build --webpack` passed with synthetic environment values.
- Scoped lint, `git diff --check` and protected-file hash checks passed.
- The final local preview rendered v6, opened a chat with header y=0 and shell
  group opacity=0, retained the previous draft and returned to the resident list.
  These are desktop observations, not phone proof.

Final action results are `browser-results/fullscreen-comms-actions.json`;
the build log is `polish-v6-build-final.log` in the diagnostics directory.
`polish-v6-validation.json` bundles the reports and source hashes for this pass.
