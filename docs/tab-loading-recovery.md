# Tab loading recovery — 2026-09-11

## Observed failure and causes

The authenticated macOS Betelgeze PWA showed Communications indefinitely covered by its loading skeleton while the iframe accessibility tree already contained the conversation, messages, and composer. No messages were sent or edited during diagnosis.

The source exposed several independent lifecycle failures:

- Server bootstrap can return a new initial tab ID on revalidation. The mounted shell retained its existing tabs, but its iframe ref callback depended on the new ID. React detached that ref, deleting readiness; the unchanged document did not necessarily emit another location event. The old probe effect targeted only the server initial ID.
- The eight-second soft-navigation fallback could hard-navigate a frame whose App Router transition was still valid. At twelve foreground seconds another path restored the old document. Tab activation and late iframe load events also attempted URL repairs, including while a cold frame still reported `about:blank`.
- An old location/probe reply during navigation could trigger another navigation request. Native read failures finished telemetry without settling shell loading, and newly opened/restored tabs did not consistently have a UI deadline.
- A native read had no transport deadline. A hung request occupied the shared cache request slot, so further reads/retries coalesced with it indefinitely.

These are demonstrated code mechanisms, not a claim that every production incident has the same cause.

## New behavior

The mounted shell retains its bootstrap tab identity. A new iframe resets readiness inherited from another renderer. Initial, new, and restored active tabs receive a foreground failure deadline and at most five scheduled local readiness probes, plus focus/visibility recovery while still unready. A warm ready tab skips this recovery work.

The delayed fallback now probes instead of navigating. Activation and iframe load events also probe without repairing/restarting the document. Stale replies cannot replay a newer pending navigation. The twelve-second foreground deadline offers an error and Retry while retaining the requested document for matching late completion. Explicit iframe Retry can reload even when the failed URL is already in the address bar.

Native failures settle the shell state immediately. Native cache reads have a thirty-second deadline covering the response body too; expiry aborts the fetch, releases deduplication, exposes an error, and retains existing cached content. Late or invalidated results cannot overwrite newer data. There are no automatic retry fetch loops. Until that transport deadline expires, concurrent native refresh requests still coalesce intentionally.

Existing authentication, account-scoped caching, mutations, autosave checkpoints, chat contents, and navigation paint metrics remain in place. No schema, paid service, or provider configuration changes are needed.

## Validation

- `npm test`: 866 passed, zero failures, skips, or cancellations (including the late URL-replacement follow-up).
- Changed-file ESLint and `git diff --check`: passed.
- Production `next build --webpack`: passed compilation, TypeScript, and page generation.
- Eight production-callback regression tests cover bootstrap/ref identity, renderer changes, timer probes, late load events, stale replies, immediate native failure, cold/restored versus warm recovery, and a committed URL replacement after timeout. They pass on the fix. Against the original source, the initial suite fails; some baseline failures are missing revised bindings, while the load/replay/failure cases directly exercise the old behavior. The URL-replacement case independently failed before its follow-up correction.
- Three additional deterministic cache tests cover hung-request expiry/retry, retained data after background timeout, and invalidated generation isolation. Existing lifecycle tests now verify late legacy completion without rollback as well as native/hidden-tab recovery.

These are deterministic regression checks, not end-to-end latency percentiles. Warm navigation adds no data request through the recovery path; local probe messages do not call the server. The existing performance targets have not been relaxed. Physical-device mobile testing and representative latency measurements remain distinct from these checks.

## Release and rollback

Release through the isolated `codex/tab-loading-recovery` branch and its PR. Verify the exact production revision and perform authenticated navigation checks after deployment. Record the outcome in the release report/PR; do not infer deployment from a local build.

Rollback is a code revert. There are no data migrations or queued jobs to undo. `app_speed.md` records the revised standard and must be kept consistent with any rollback.
