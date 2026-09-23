# Remaining shell departure repair

**Approved continuation:** the user explicitly authorized this bounded local work with “please proceed.” The resulting source and focused checks are recorded in [shell-departure-continuation-validation.md](./shell-departure-continuation-validation.md). The proposal and rejection details below are retained as the scope and approval history; they no longer describe an unapplied current candidate.

This is the concrete local continuation scope after automatic approval review rejected the commit-wrapper implementation. It authorizes no deployment, migration, client-data operation, provider call or protected alerts behavior change. The current accepted candidate is saved separately from the unapplied proposal.

## Problem and affected paths

The host currently confirms that an editor's draft is safe, then schedules React state changes. React can remove the editor in a later commit; input accepted in between is not covered by the earlier confirmation. A successful test of the acknowledgement alone does not establish safe unmount.

The review-only [proposed wrapper](./proposed-shell-commit-wrapper.patch) encloses the ten existing prepared-departure callers and speculative residency eviction. Static AST comparison preserves their current success/refusal bodies and finds no asynchronous operation inside their commit callbacks. This is not mounted React or performance evidence.

Independent review also identified `NativeWorkspaceTab.navigate`: it flushes and then synchronously calls the host's native `navigation-start` or `location-replace` handler, which updates the tab URL outside those ten callers. Applying the existing patch by itself would leave this path uncovered.

## Proposed local work

1. Keep the draft acknowledgement, final validation and destructive React commit under one explicit owner. Review the proposed `flushSync` callback boundary in `WorkspaceTopBarClient.tsx` so only operations displacing an existing editor require synchronous commit. Preserve cancellation, current metadata, failed-save retention and the three-resident limit. Ordinary owner-free operations keep their current scheduling.
2. Extend the same guarantee to normal and replace navigation initiated inside `NativeWorkspaceTab.tsx`. Preserve its current intent sequence, active/account/source checks and single save attempt. Capture edits before flushing and validate at the synchronous host commit; do not add a second network flush. Audit cross-document departures separately against existing unload/checkpoint behavior rather than claiming a React wrapper proves them safe.
3. Add actual mounted React fixtures with synthetic editors for late input, slow/refused saves, competing navigation, normal/replace native navigation, iframe/native replacement, close, Retry, full-pool eviction and reopening. Exercise Suspense/error boundaries and StrictMode where relevant. Keep failed editors mounted and ensure a successful save does not reject its own mutation event.
4. Run those isolated fixtures through Chromium and WebKit, plus the protected activity-order tests, scoped lint, full repository suite and production build. Compare matched warm/cold navigation work and timing. No live client records, real messages or production load tests are fixtures.
5. Have the completed diff independently reviewed. Any missing behavior or credible unresolved slowdown remains a release blocker. Physical Android/Chrome and iPhone/Safari/PWA evidence remains a distinct subsequent release gate.

## Why confirmation is needed now

Automatic approval review rejected the proposed source mutation with this reason: “This broad refactor changes nearly every workspace navigation path to use flushSync and a new commit callback, with substantial unverified control-flow risk around navigation, eviction, and draft safety.”

The partial proposal was preserved as review text, not applied through another route. Static review improved the evidence but also demonstrated missing native-path coverage; it cannot settle the cited runtime risk. The requested approval is to complete and test this bounded repair locally. It is not approval to release the current candidate or to change client data.
