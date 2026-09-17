# Launch and error recovery — 17 September 2026

## Evidence and limits

The supplied 12.6-second iPhone recording shows a black launch surface followed by a blank white page. It contains no app error code. It predates `22911da4`, which stops service-worker `respondWith()` handling for navigations; that behavior is preserved. The latest production deployment inspected during this investigation was READY (`dpl_6wogZp64GyKX8nKF87MD4pPcHqwS`). That does not prove the recorded device received its worker update or recovered.

The existing authenticated desktop PWA displayed an SOP and its controls. A separate authenticated Safari queue launch appeared stuck at the diamond even though scripts had downloaded and the shell was present in hidden streamed segments. Inspector reported `document.visibilityState === "hidden"` and queued React reveal work. This is not a valid foreground reproduction or evidence that the startup cover is the cause. The recent bounded server-log query returned no errors; recorded client-boundary incidents from 15 September reported `Load failed`. None identifies the exact cause of the supplied iPhone incident or the user's latest desktop error.

## Confirmed recovery defects and changes

- Worker registration/update waited for `window.load`, which also waits for child documents and images. A hung tab could prevent checking for the fixed worker. Registration now starts from the hydrated top-level app without waiting for those resources. Embedded tabs no longer register/update the same worker. A resident app checks again on visible focus/resume after one hour; there is no polling timer or controller-change reload.
- The app error screen used Next's `reset`, which only clears the boundary state and can immediately rethrow the same rejected server payload. Both app and global error screens now use the installed Next 16.2 `unstable_retry` callback, which refreshes that document's server payload before resetting the error. Global errors have a touch-accessible retry instead of instructions to close the app and sign in again.
- A page error unmounts `WorkspaceTabBridge`. The error reporter now sends a matching `navigation-failed` message to the parent and answers its existing bounded readiness probes. It does not claim useful-content readiness. The shell exposes its existing error/Retry state immediately; a matching later page can still recover. Parent origin, window identity, tab ID and message type are checked; the host retains its destination checks.

These changes fix demonstrated recovery dead ends. They are not proof that the original blank iPhone launch or the unobserved desktop error is fully resolved. A document that never receives/runs app JavaScript cannot execute this registrar or error UI.

## Performance and state preservation

Successful panel navigation adds no request, timer, cache invalidation or remount. Error acknowledgements are local messages and do not repeat telemetry. Explicit error Retry fetches the failed document's server tree, retaining the parent shell and its other tabs. Worker registration moves earlier and becomes top-level-only; checks on resume are bounded to once per hour and do not block rendering, reload documents, clear caches, unregister subscriptions or erase drafts. Existing authentication, MFA, data access, offline data and push handling are unchanged.

This is a control-flow/resource assessment, not a measured launch-latency improvement or percentile benchmark. No speed threshold is changed.

## Validation

- Nine new runtime regressions pass, executing the production components with browser fixtures and the actual installed Next error-boundary handler. The same nine tests fail against the pre-change components. They cover a child document that never finishes, top-level-only registration, throttled visible resume, failed/late registration, server-payload retry, missed parent listeners, and untrusted/unrelated frame messages.
- The focused launch/worker/frame suite passes all 24 tests.
- Full suite: 1,145 pass, zero failures/skips/cancellations. The initial checkout lacked PDF/image test dependencies; existing bundled runtime packages were made available only in the isolated worktree's dependency overlay. No package manifest, lockfile or primary checkout dependency changed.
- Changed-file ESLint and `git diff --check` pass.
- Production `next build --webpack` passes compilation, TypeScript and page generation. Existing Google Fonts downloads required network access.
- A separate production Next fixture rendered the patched error screen in Chromium and delivered `navigation-failed` to its parent. Browser-control timeouts prevented completing the click-to-recovery check; it is not counted as a passing end-to-end retry test. The framework callback's server-refresh behavior is covered by the runtime regressions above.

Physical iPhone/Safari/PWA and Android/Chrome launches, authenticated patched-browser recovery and representative foreground performance remain unverified. No production deployment or database mutation was performed for this patch.

## Release and rollback

Prepared in the isolated `codex/launch-tab-recovery` worktree based on `22911da4`, preserving the dirty primary checkout. Release must verify the deployed revision and exercise cold launch, suspended resume and failed-panel recovery on both mobile platforms. Rollback is a code revert; there is no migration or stored-data conversion.
