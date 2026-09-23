# Mobile motion audit evidence

Source: `/private/tmp/betelgeze-platform-consolidation`, audited main commit `31388081894e6d4143d5bb0d577c0341ec31edf7`.
Runtime: Node.js v24.16.0. Collected 2026-09-23. These artifacts are outside the application checkout.

## Existing regression coverage

Command, from the source directory:

```sh
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/chat-viewport-motion.test.ts tests/composer-viewport-controller.test.ts tests/viewport-origin-recovery.test.ts tests/chat-viewport-state.test.ts
```

`mobile-original-tests.log`: rerun of the unchanged original test set, 42 passed, 0 failed. This does not cover the reproduced interrupted-touch resident-frame return case.

## Additional failing regression

```sh
node --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON /private/tmp/be-consolidation-evidence/mobile-hidden-frame-reproduction.mjs
```

`mobile-hidden-frame-reproduction.log` captures the expected baseline assertion failure (exit 1). The script reads the existing fixture from `tests/chat-viewport-motion.test.ts`, adds a show operation in memory, and calls the real `lib/chat-viewport-motion.ts`. It changes no application files.

Sequence: keyboard motion starts; a message-pane touch begins; frame hides with no touchend; hidden frame retires the pending motion; frame returns; next keyboard motion finishes and its fallback timers run. The implementation retains stale touching/interacting flags. The visual bottom reaches 500px, but the applied viewport remains 800px and the temporary 700px layer height, moving marker, and transform hint remain.

Source pointers:

- `lib/chat-viewport-motion.ts:44-54`: release clears motion, not gesture ownership.
- `lib/chat-viewport-motion.ts:75-90`: gesture starts and hidden-surface retirement path.
- `lib/chat-viewport-motion.ts:122-135`: stale interacting flag blocks completion and fallback.
- `lib/chat-viewport-motion.ts:137-153`: page lifecycle resets exist, but no resident-tab activity reset.
- `components/workspace/WorkspaceTopBarClient.tsx:324-333`: resident frame hides without document navigation.
- `lib/workspace-tab-activity.ts:22-30`: resident tab selection has its own activity event.

Repair boundary: retire stale gestures on hidden/deactivated surfaces without applying an old request; retain deferral during a genuinely active visible touch scroll. Preserve messages, drafts, authorization, read/unread/activity predicates, and notification behavior. Shared portal use requires regression coverage.

Evidence limit: deterministic helper fixture only; no real browser, physical Android/Chrome, physical iPhone/Safari/PWA, provider, or production claim. No production or database operation was run.
