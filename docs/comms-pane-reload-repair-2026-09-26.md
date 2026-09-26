# Comms message-pane reload repair — 26 September 2026

Base: `a987f2e99b9595c3a1a510679d55aaf61d61fcc4`. Scope: a selected client or Team conversation sometimes keeps its header and composer but shows a black message pane after reload, on desktop and mobile. Selecting another conversation restores messages.

## Cause and repair

`MobileConversationSurface` creates its portal target in a ref callback and renders its children in a subsequent component update. With a conversation selected before that update, the parent `useConversationLayout` layout effect runs before the message pane exists. Its dependencies do not change when the surface alone renders the children. Consequently no layout observer attaches, and the deliberate `invisible` gate never receives `data-positioned="true"`.

The hook now returns a stable DOM callback ref. Both Communications workspaces attach it to the message pane, so the existing positioning observer starts when that exact element arrives, including delayed bootstrap, replacement with the same conversation ID and StrictMode remount. React ref cleanup disposes the observer and releases the shared object ref. Other readers/actions retain that object ref.

The visibility gate, bottom positioning, historical scroll anchoring, mobile surface, header, composer focus and motion calculations remain unchanged. This adds no requests, polling, storage, subscriptions, dependency packages or database changes. Callback identity remains stable during normal message/composer updates. Observer ownership is one per mounted pane, with disposal on replacement/unmount.

## Reproduction and regression coverage

The new loopback fixture uses the actual layout hook, message observer, mobile portal and chat motion components plus application CSS. It does not manually mark messages positioned. Header/composer content and messages are synthetic. The fixture uses development React to exercise real StrictMode callback/effect replay; this is correctness evidence, not a production performance benchmark.

Run the failing baseline:

```sh
COMMS_PANE_BASELINE=a987f2e9 COMMS_PANE_REPORT=browser-results/comms-pane-lifecycle-baseline.json node scripts/browser/run-comms-pane-lifecycle.mjs
```

Run the candidate:

```sh
node scripts/browser/run-comms-pane-lifecycle.mjs
```

Across Chromium and WebKit at mobile and desktop widths, the baseline fails 24 of 52 assertions. Each failure has a nonzero-height message pane with CSS `visibility:hidden`, no positioned flag, and visible header and composer. Six failing cases per engine/viewport are cold preselection, empty preselection, delayed bootstrap, initially inactive mode, same-ID pane replacement, and StrictMode cold preselection. Warm selection controls pass.

Candidate validation and hosted rollout evidence are recorded separately below. This repair makes no claims about new physical-device acceptance or sustained production latency. No real conversations were opened or messages sent for the fixture.

## Rollback

Revert this bounded application change if necessary; no data or schema rollback is required. The baseline can reintroduce the diagnosed blank-pane condition. Do not remove the established mobile viewport or alerts fixes as part of this rollback.

## Local candidate validation

- `npm test`: 1,333 passed, zero failures/skips.
- `node scripts/check-foundation-changes.mjs --base a987f2e9 --lint`: passed; no migrations added or changed.
- `npx next build --webpack` with placeholder Supabase environment: passed.
- Existing foundations: 446/446 assertions across Chromium/WebKit.
- Existing Comms interaction/popup/media/safe-area suites: 176/176.
- Existing acknowledged read/unread suites: 136/136 at desktop/mobile widths in both engines.
- New pane lifecycle suite: 52/52, including exactly one current-pane layout observer, no observers on replaced panes, and zero live observers after unmount.
- Total browser assertions: 810 passed. No unexpected non-loopback requests or page errors in the new lifecycle suite.
- Independent read-only review found no callback cleanup, retained-scroll or reader-semantic issue.

Hosted CI and exact production deployment status must be verified before release completion and recorded in the release handoff. The new lifecycle suite is included in both hosted browser-engine jobs. Physical iPhone/Android acceptance and authenticated real-app reload confirmation remain separate from the synthetic checks.
