# Local v5: messages and composer motion

Local candidate only. No deployment or production data changes.

## Accepted baseline and scope

The user physically tested Local v4 and reported no jumping. Their saved capture
is preserved at `/private/tmp/mobile-comms-displacement/phone-focus-v4-accepted.json`.
During its keyboard cycles, the header stayed at y=0 and pageTop, offsetTop and
document scroll stayed at zero. At latest, the final message/composer gap stayed
about 20.2px, but each 320px height change was applied in one sampled step. During
native scrolling, the existing scroll owner deliberately skipped compensation.

V5 adds presentation below the header. These v4 files are byte-for-byte unchanged:
`ChatComposerInput.tsx`, `composer-pointer-focus.ts`, `ComposerFooter.tsx`,
`MobileConversationSurface.tsx`, `mobile-conversation-viewport.ts`, and
`app/globals.css`. Their hashes are recorded in
`/private/tmp/mobile-comms-displacement/motion-v5-protected.sha256`.
No focus event, caret/selection behavior, viewport origin/height calculation,
header positioning, navigation coverage, composer sizing rule or visual design
is replaced. The new shared layer animation moves messages and composer together;
the root and header are outside that animation.

## Presentation ownership

`observeMobileConversationMotion` consumes the existing atomic pre/post layout
events. It retains enough inner layout for both endpoints and translates that
layer with the previous Comms 300ms duration and easing. The root still accepts
actual viewport geometry synchronously. There is no keyboard-size prediction,
document scroll reset or second viewport controller.

Same-direction corrections continue from current paint with the original
deadline; reversing direction starts at current paint. Reduced motion uses
natural layout. Existing anchored popups skip cosmetic motion. New message rows
end idle cosmetic motion before the existing two-frame visibility check; the
read predicate, read hook, notifications and subscription owners are unchanged.

The existing message observer remains the sole scroll writer. Opening during
native dragging or inertia retains real pane geometry until the gesture settles.
Closing during that gesture adds a temporary leading content inset before the
pane expands, preserving both content position and native scroll range without
writing scrollTop. After the existing 200ms scroll settlement, the motion owner
retires that inset and temporary geometry at 220ms in one layout transaction.
At the oldest-message boundary, an impossible negative scroll is avoided by
retiring remaining visible space with a bounded 180ms pane animation. A new
viewport transition or gesture absorbs its current paint into the next layout;
reduced-motion changes cancel it. All temporary styles and animation state are
released on departure/disposal.

## Speed and evidence boundaries

No requests, extra subscriptions, remounts, per-row listeners or animation-frame
JavaScript loop are added. The browser runs the transform animation. Layout
reads/writes occur at geometry handoffs and completion, with bounded timers and
two narrowly scoped mutation observers per mounted conversation. Native scroll
events only update gesture state/timers. There is no new message-history scan
beside the existing anchoring owner.

The browser fixture exercises actual animation paint positions, native element
scroll bounds and the existing message observer/visibility predicate, using
synthetic data. It does not reproduce iOS keyboard compositor timing or prove
physical native inertia/selection behavior. Those remain phone acceptance items.

## Local test

Open `http://192.168.0.108:3107/?v=5` on the same Wi-Fi as the Mac. Confirm the list
shows **Local v5 · Record test**. Record a test, open a conversation, and check:

- Keyboard opening and closing, including quick reversal: messages and composer
  travel together; the header remains fixed and the shell stays covered.
- Reading older messages and scrolling while opening/closing the keyboard:
  movement remains continuous and finishes without displacement.
- Short/long drafts and native selection: the accepted v4 focus behavior remains.

Return to the list and **Stop & save**. The numeric-only diagnostic remains local,
retains its 45-second cap, and identifies this candidate as `comms-motion-v5`.
Physical iPhone Safari/Home Screen and Android Chrome/installed-mode evidence
must be reported separately. Production remains unchanged until approval.

## Validation

- Repository suite: 1,324/1,324 passed.
- Final production `next build --webpack`: passed with synthetic environment values.
- Broad foundation matrix: 202/202 Chromium and 202/202 WebKit passed.
- Subsequent final motion regressions: 23/23 in each engine, no page errors.
  These include rapid reopening/gesture takeover during boundary retirement,
  changing reduced-motion preference, origin-only notifications, and closing
  during native scrolling one pixel from latest. The latter reproduced a
  WebKit-only automatic clamp; committing the added scroll extent before pane
  expansion resolved it without a scroll write.
- Final focused reports verify the served helper matched source SHA256
  `daa413bf74e648197915cb269795f6b74a953fa167a23bf58ef91ce1a8debb53` before and
  after both engine runs. Protected v4 file hashes remained unchanged.
- Changed-file lint, syntax checks and `git diff --check` passed. The preview
  rendered Local v5, opened a full-screen chat, preserved its previous draft,
  and returned to the retained list.

Final automated results are recorded in `motion-v5-unit.log`,
`motion-v5-build.log`, `motion-v5-lint.log`, `motion-v5-browser-final.log` under
`/private/tmp/mobile-comms-displacement/`, and `browser-results/foundations.json`.
`motion-v5-validation.json` bundles the broad matrix and final hash-verified
motion reports. These are separate observations, not physical v5 acceptance.
Rollback removes the new presentation observer and restores the v4
`ChatMotionViewport` owner selection; the accepted focus/root/header code and all
drafts/history/data remain intact.
