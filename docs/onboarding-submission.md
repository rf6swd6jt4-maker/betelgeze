# Public onboarding submission

The client advances only after the server acknowledges the database commit. The existing completion RPC stores the form response, upload asset links, progress, and the next work-item window together. Staff detail pages continue to read those authoritative assets. There is no browser-owned final-save queue or deferred copy into the staff page.

The public page prepares the frozen step definitions and signed media URLs once. Only the current step is mounted. A successful JSON submission response updates the current step, roadmap, and URL locally. Refresh and revisiting a step use the server again. Changed compositions, unknown next steps, expired prepared media, and final portal handoff use the normal navigation path.

The submit Route Handler avoids the Server Action dispatcher and its current-page RSC re-render. Its resolver reads the active frozen fields and live work items without loading branding, release notices, builder configuration, or block display responses. Required fields, token authorization, order, and database block requirements remain enforced. Existing legacy sessions retain the repair and compatibility path.

Files start uploading when selected. After transfer, a batched server check confirms the object size and content type in R2 and returns a signed receipt bound to the workspace, relationship, session, step, field, and object metadata. Valid receipts avoid repeating storage checks during Continue. Old or absent receipts require a fresh object check. A failed confirmation retries the existing object; an interrupted transfer can be retried. Required uploads still finish before advancing.

A lost acknowledgement retries the exact submission payload once. A completed form only acknowledges matching saved answers; a different payload is rejected. Submit failures resume draft autosave. Local storage cleanup cannot turn a successful server commit into an apparent failure.

## Diagnostics

The submit response exposes `Server-Timing` entries for `context`, `commit`, and `total`. Browser Performance measurements split `onboarding:pending-saves-and-uploads` from `onboarding:submission`. These contain durations rather than client answers or tokens. Measure ordinary production sessions before promising a fixed latency target.

## Verification

The functional tests cover upload receipt scope, altered metadata, expiration, duplicate answer matching, lost acknowledgements, offline failures, validation errors, and eligibility for local navigation. The local browser fixture exercised an error followed by a successful retry, one stored submission despite a lost acknowledgement, advancement without a page request, refresh, a read-only revisit, and mobile completion at 390px. The fixture used synthetic data and does not establish an authenticated production upload-to-staff-detail journey.

## Restart and replay

Restart uses `restart_relationship_onboarding_session` in one database transaction. It clones the current frozen modules, non-superseded steps, fields and blocks into new IDs, keeps test mode and the project timeframe, and transfers the sale's current-session association without changing its payment status. The archived run retains the original sale ID for history. New runs have no drafts, uploaded assets or satisfied block responses; historical submissions, uploads, completed work and external service connections remain stored.

The old token is revoked only as part of the successful transaction. The rendered session ID makes double clicks and lost acknowledgements idempotent. Legacy runs without a complete normalized snapshot fail without archiving the original. The detail page refreshes its link controls when the session changes.

After deployment, refresh the test relationship's onboarding detail page, use Restart onboarding, then open Preview session to replay the same frozen flow after its existing payment. This is a new run of the same relationship, with a new client link. The release does not expose an old/new mode switch: comparing against the previous implementation requires a baseline recorded before deployment.

The SQL integration check in `tests/sql/onboarding-restart.sql` runs against an existing test session inside a rolled-back transaction. It verifies rollback, admin authorization, test/payment preservation, frozen definitions, blank progress, historical asset preservation and idempotent retries. It does not reset the user's test session permanently.
