# Client Connections providers and Windsor return recovery

Historical implementation report for the release preceding the provider-first Add connection revision. Statements below describe the state at that report’s preparation; its outstanding deployment checklist and validation results do not certify the later revision. See `client-connections-add-flow-2026-10-27.md` for the current work and release hold.

Candidate base: `15aa5c1a4961bf04b090457aa1176c27edab3e45`. Work is isolated on `codex/client-connections-providers`. This report records implementation and local verification, not deployment or live account correction.

## Findings on 27 October 2026

The deployed collection reads HighLevel rows only. Its Meta Ads action opens a separate maintenance dialog, so its Active status describes HighLevel and cannot describe Google Ads or Windsor.

Read-only inspection found Jason's old Windsor account marked connected, with its original onboarding requirement satisfied and the onboarding session completed. His newer staff authorization attempt existed, but had no selected account, report preview or verification. The staff dialog did not listen for return/close signals; after Windsor displayed completion, it still required the operator to find and press Load authorized accounts.

With explicit user permission, one GET through the existing client portal report endpoint returned HTTP 503. Vercel's matching sanitized diagnostic was `provider_http_4xx`, rather than a missing integration or decryption failure. The saved reporting metadata also carried an earlier failed attempt and no business-account verification. This establishes a current provider rejection, not its precise cause; the key and raw provider error body were not exposed. No production row, account selection, onboarding record or migration was changed. No provider authorization was created by this task.

## Changes and ownership

The existing HighLevel reader, list state, editor, OAuth, calendars and retirement transaction remain their owners. Advertising summaries render as additional standard List rows, identify the provider in the secondary band, and use shared Status and detail primitives. Google Ads, direct Meta Ads access, and Windsor reporting each have their own identity/status. Expired Meta authorization and unverified/failed Windsor reporting are yellow.

One independent, private authenticated GET loads the advertising page after the existing HighLevel content mounts. Its new service-only `read_client_advertising_connections` RPC checks active workspace membership and reuses the canonical Client Connections setup scope for staff. Owners/admins retain archived connection visibility. It reads no encrypted authorization, credentials, reports, account arrays or historical records. Each provider contributes at most 51 candidates; the merged page returns at most 50 records with a `(relationshipId, provider)` cursor. Existing workspace/relationship indexes and custom plans keep optional scopes/cursors indexed. There are no new indexes, triggers, row updates, background polls or provider calls on the list path.

Advertising requests time out after 30 seconds, cancel superseded/unmounted work, preserve loaded rows on transient failures, retry the exact failed query, and clear advertising rows on access loss. A confirmed Windsor save refreshes only that relationship's advertising summary, preserving other loaded pages and HighLevel state.

The existing lazy Windsor maintenance dialog now observes return, visibility and popup-close signals only during its pending authorization. The existing return monitor coalesces signals, retries only empty account results with its finite backoff, pauses failures, and makes no hidden-page provider requests. The local close watch ends after 30 minutes and cleans up on disposal. A synchronous operation guard prevents automatic/manual requests from overlapping. Successful account discovery stops the watcher and explains the remaining preview and explicit confirmation. It never auto-selects or auto-saves a reporting account. Existing revision, authorization and lost-acknowledgement guards remain.

## Validation and speed evidence

- Full repository suite: 1,843 tests passed, zero failures. An existing source assertion was updated from the former Client accounts accessible label to Client connections.
- Changed-file lint, foundation migration/lint checks and `git diff --check` passed.
- Production webpack build with local placeholder credentials passed; no provider/production credentials were used by the build.
- `run-client-advertising.mjs`: Chromium and WebKit, 1280px and 390px. Verified HighLevel remains usable while the advertising request is deliberately held; one initial summary GET; all providers; pagination; retained rows on failure; exact retry; permission-loss clearing; standard two-band rows; no horizontal overflow or browser errors.
- Existing `run-client-connections.mjs`: both engines and widths passed on-demand maintenance, saved-token editing, calendar selection/save, cancellation and confirmed retirement, preserved other clients, archived restrictions, retained history and geometry.
- `validate-windsor-browser.mjs`: both engines and widths passed automatic staff return/close account loading, isolated popup opener, required report preview/confirmation, unchanged old selection before confirmation, lost-save-acknowledgement recovery, onboarding scenarios and retained-report failure/retry. All external browser requests are blocked.
- Synthetic PGlite regression: 60,003 provider rows; bounded first/next/relationship pages, page boundaries inside one client's providers, unknown actor/tenant denial, staff scope, revocation, expired/unverified states, secret exclusion and service-only grants passed. An indexed keyset plan was verified. Thirty warmed observations of the new 50-row RPC gave median 1.69 ms and p95 1.99 ms including the local PGlite call; the first response was approximately 17.2 KB. This is a new independent metadata read, not a before/after production latency improvement.

The existing server-page useful-content dependency graph and HighLevel mutation reads are unchanged. Advertising adds one authorized summary request, bounded rendering and transfer after that content mounts. There is no claim of zero total resource cost or measured production latency. Browser component fixtures, database observations, builds and unit tests do not establish authenticated deployed behavior, physical iPhone/Android acceptance or sustained-session performance.

## Rollout and rollback

The additive migration `20261027160000_client_advertising_connections.sql` requires Client Connections controls and Meta reporting readiness. Rehearse and install it before deploying its caller. It adds only a restricted read function; do not replay historical migrations. The old application remains compatible. Application rollback can leave the unused read function installed and preserves all provider bindings, reporting grants/previews/history, completed onboarding, stored files and retired HighLevel history.

Deployment, hosted exact-commit CI, authenticated deployment checks and physical-device acceptance remain outstanding. Jason's live provider rejection remains unresolved; use the repaired flow to load his client-authorized accounts, preview the intended account and explicitly confirm it. Do not interpret Windsor's external completion message as a saved Betelgeze selection or as proof that reporting works.
