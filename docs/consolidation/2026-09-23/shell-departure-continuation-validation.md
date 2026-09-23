# Shell departure continuation: implementation and focused evidence

The user explicitly approved completing and testing the bounded local repair after the earlier automatic-review rejection. Work continued from `7a35b73d` in `/private/tmp/betelgeze-platform-consolidation`. The reviewed patch was treated as a starting proposal, not proof. This package made no production, provider, migration, deployment or client-data calls and changed no protected alerts behavior. `app_speed.md`, `app-alerts.md` and installed Next routing documentation were read before the implementation.

## Implemented ownership

- `prepareNativeLeave` now returns a commit callback. Every one of its ten existing caller paths supplies its destructive body to that callback. The current owner is validated inside the same `flushSync` callback as the destructive React update, closing the previously demonstrated check-to-React-unmount scheduling interval for these host-owned removals. Failed saves, missing/changed owners and superseded operations do not run the body. A merely truthy function cannot authorize Retry.
- Sync work is conditional on a displaced frame/native owner. Switching to an already resident native tab keeps ordinary React scheduling while preserving its existing single save. Replacing an inactive native destination is recognized as displacement and receives the save/final-validation path too. Actual full-pool speculative eviction uses a synchronous commit after checkpoint-only validation; it does not start a network save.
- `NativeWorkspaceTab.navigate` uses a typed in-process `prepareNavigation` capability. It captures the source route, mounted owner, actor/workspace and local intent before one save, then supplies final draft validation to the host's single-use commit callback. Push and replace share that path. The host fences its own competing intent and current source before changing the route. The old native `navigation-start` and `location-replace` messages are rejected as mutation paths, so they cannot bypass the new owner.
- Native mounted-owner tokens are stable across handle renewal but change on remount. Final host checks compare the exact scoped frame/native inventory, including previously absent owners; a late mount cannot escape an earlier empty inventory. Captured frame identity includes element, document, window, receiver marker and document token. An unchanged iframe element alone is insufficient. Unrelated retained-frame mounts do not invalidate the check.
- Account scope is updated in a layout effect and invalidates outstanding work even when no optional account-clearing event fires. Explicit clearing/unmount behavior remains. Activations also require the captured residency snapshot, preventing a stale capped-pool calculation from destroying a different owner.
- Native saves capture edits before flushing and arm post-flush mutation checks only after acknowledgement. The save's own mutation event is accepted; a user edit during the save, a new edit/mutation after acknowledgement, or a replaced registry refuses departure. There is no second save, input lock, polling loop or automatic refusal retry.
- Creation modal and same-source-URL intents retain their existing owner. Creation does not supersede a valid host departure generation or force a route commit. Native source/owner cancellation is reported as an aborted intent rather than a fabricated save failure. External navigation retains its immediate validation and browser assignment, with the separate unload limitation below.
- Reopening computes its next tab state and runs activation/persistence once outside a functional state updater, avoiding StrictMode updater replay of those effects. Superseded popstate failure cannot restore a stale previous address over a newer navigation. Current failures still restore their retained source URL.

## Focused checks

The final focused group passes **43/43**, with output at `/private/tmp/be-consolidation-evidence/shell-continuation-focused-tests.log`:

```sh
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  tests/workspace-tab-departure.test.ts \
  tests/workspace-native-departure.test.ts \
  tests/workspace-departure-final-check.test.ts \
  tests/workspace-native-error-recovery.test.ts \
  tests/workspace-native-ready-handshake.test.ts \
  tests/communications-read-state.test.ts
```

These tests execute actual AST-extracted callbacks with deterministic dependencies and the real departure/autosave helpers where relevant. They cover host/native refusal paths, one-save push/replace, self-flush acceptance, competing intent, changed scope/source/mount, stable handle renewal, scoped late owners/documents, unrelated mounts, changed residency, retained-owner scheduling, stale popstate rollback and bounded checkpoint warming. They are behavioral callback tests, not a mounted React tree or authenticated application test. The protected activity tests still prove old-chat activity revocation precedes the queued frame activation, including delayed departure acknowledgement.

All eight touched application/helper/test files pass scoped ESLint with **zero errors and warnings**. `git diff --check` passes. The prior intentional latest-sequence cleanup warning was resolved by capturing the stable ref object, preserving invalidation of its latest value on cleanup.

The independent reviewer additionally exercised 11 current-source owner/scope scenarios and reported no remaining high-confidence defect in this bounded scope. Actual mounted React/browser fixtures, exact final Chromium/WebKit results, matched timing/work observations, the full repository suite and production build are separate integration evidence. Do not substitute the callback-test count for those results or add overlapping counts as unique tests.

Final application-source SHA-256 values at freeze:

| File | SHA-256 |
| --- | --- |
| `components/workspace/NativeWorkspaceTab.tsx` | `62d5cf33e7724bc81f132313d0cddefd6dd8c88409d3bf2cba967617c3b6f6a5` |
| `components/workspace/WorkspaceTopBarClient.tsx` | `93437e551dc93dd04a827c16888889ee573b374fbcb40facfc0a587b70e16fdc` |
| `lib/workspace-tab-departure.ts` | `facb9f7b9670361b9a47ba1f0289ccd4dc1097fb60c6ec97adb78c4cac58a641` |

## Limits and promotion

This repairs the host React commit interval and native in-panel commit path. It does not establish final browser document unload safety, hard frame-navigation completion, recovery from a permanently rejected lazy import, or final commit safety inside a legacy streamed Next transition. See [navigation-departure-boundaries.md](./navigation-departure-boundaries.md). React may flush pending effects or expose a Suspense fallback; mounted behavior and matched work/timing evidence are therefore required separately.

No physical Android/Chrome or iPhone/Safari/PWA evidence, authenticated production navigation, provider delivery or deployment is claimed. The documented remaining editable-route boundaries and release gates require resolution before production promotion. The earlier automatic-review rejection is preserved in the historical report; the implementation resumed only after the user's explicit approval and includes runtime validation beyond the original partial patch.
