# Workspace loading failures — 15 September 2026

## Confirmed mechanisms

The supplied screenshots show a native panel saying “Access changed” and mobile tabs remaining on their opening skeletons with a navigation timeout. The following production-code defects were reproduced using isolated network/auth fixtures; the screenshots alone do not identify which request failed in each incident.

1. `requireWorkspace` ignored workspace/membership query errors. A transient failure became an absent membership and redirected to `/workspaces`. The legacy-column fallback also ignored its query error.
2. MFA assurance/enrollment lookup failures were treated as a requirement to challenge the user again. Native reads followed those redirects, then classified them as session changes.
3. Native panel reads treated every 403/404 as an account-wide access change. A single inaccessible or removed record cleared the shared panel cache and blocked the tab behind “Reload workspace.”
4. A cancelled native read could still classify a late response or parsed JSON as a session change, triggering that same reset.
5. Explicit native Retry swallowed failures. The shell started a new navigation deadline but received no failure acknowledgement until that deadline expired. The panel continued rendering an opening skeleton even after its read had failed.

## Patch

- Failed workspace/membership/MFA verification throws a retryable error, without granting access or redirecting on unverified assumptions. Successful checks, actual absent membership, actual MFA requirements, and account identity enforcement remain intact.
- A 403/404 discards only the affected record snapshot, displays an unavailable/access-denied error, and supports explicit retry. This policy applies to foreground and hover-prefetch reads. Other mounted panels remain resident.
- Aborted responses are rejected before status/identity handling, including after JSON parsing.
- A failed Retry immediately reports failure for its matching active empty panel. Cancelled requests and old-route callbacks do not fail the current route. Existing usable cached content survives temporary background failures.
- A settled failed read stops displaying its opening skeleton.

## Performance and security assessment

Successful launch, reads, and warm navigation make the same requests as before. No new subscription, background polling, timer, dependency, automatic retry loop, full reload, or database query was added. Recovery stops unnecessary account-wide cache clearing for record denials. The cache remains account/workspace scoped, generation-fenced, bounded, and request-deduplicated. Real session changes and mismatched private payload identities remain blocked.

This is a control-flow/request-count assessment, not a measured production latency improvement. Existing read and foreground timeout budgets are unchanged.

## Verification

- 23 focused tests execute production auth/read/refresh functions with isolated fixtures and exercise the real record cache. All pass.
- Against the captured pre-edit functions, 10 of these tests fail: workspace/membership/fallback lookup failures, MFA lookup failures, record denials, cancelled response/parse handling, and failed Retry acknowledgement. The baseline comparison uses the updated cache implementation for the separate cache-policy test; it does not claim a complete old-build comparison.
- Full suite: 1,002 passed, zero failed/skipped/cancelled.
- Changed-file ESLint and `git diff --check`: passed.
- Root production Webpack compilation passed; type-checking was blocked by existing `output/` fixtures importing an unrelated `/private/tmp/be-comms-attachments-release` checkout.
- An isolated copy excludes generated `.next*`, `output/`, and `tmp/` artifacts and preserves application source/dependencies. Its production `next build --webpack` passed compilation, TypeScript checking, and page generation. The clean build required network access for the existing Google Fonts downloads.

No authenticated patched-browser, physical iPhone/Safari/PWA, production-log correlation, or real-user latency result is claimed. The live PWA had an open service-edit dialog; it was inspected without altering the draft. The initial investigation did not deploy or migrate the database. The user subsequently authorized production deployment.

## Rollback

Revert the four runtime files and this change's test/report. There is no schema, data, provider, or stored-tab migration.

## Release verification

The approved patch was applied cleanly to current `origin/main` (`39c8a1a1`) in an isolated release worktree, retaining the deployed Work Queue and relationship-service view changes. The release suite passed all 1,061 tests; changed-file ESLint and diff whitespace checks passed. The exact release production Webpack build also passed compilation, TypeScript checking, and page generation. No unrelated local changes or database migrations are included.
