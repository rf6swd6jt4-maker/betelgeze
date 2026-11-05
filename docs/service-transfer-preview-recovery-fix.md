# Service transfer preview recovery repair — 5 November 2026

Base: `92d584d0c8a0d6acc01f9560122a137c502e8b23` (`main`). This candidate is isolated from the primary checkout's unrelated edits. Production deployment and a real client transfer require separate approval.

## Failure and repair

The final Transfer assignee action validates its exact request and preview before checkpointing through the existing draft journal. The SQL preview can legitimately contain `movable: null`: a linked work item may have a null `service_id`, and its SQL transferability expression then evaluates to null. The UI already excludes that item, and the database only permits items with `movable = true`. However, recovery validation required every value to be a boolean, so the entire handover was rejected before dispatch with “This preview cannot be safely recovered on this device.” Reloading returned the same valid SQL shape.

The client contract now admits that exact SQL null and explicitly selects only `true` items. Recovery retains the original preview, fingerprint and request without normalization. Missing values, strings, numbers and other malformed transferability data remain rejected. The fallback message now describes unsupported preview data and confirms that no transfer was sent, rather than blaming device recovery. Actual storage failures still block dispatch through the existing journal.

There is no database migration, data repair, access-rule change or new API call. The server continues to recheck authorization, the fingerprint, selected work, service version and receipt identity. No real assignments or client records were changed during validation.

## Reproduction and validation

- Before the repair, the new recovery unit case failed with an actual result of null. The isolated fixture using the existing migration's real SQL returned `movable: null` and failed the same client recovery assertion.
- After the repair, all seven targeted recovery tests pass, including rejection of malformed values and account/service scoping.
- The isolated PostgreSQL/PGlite transfer fixture passes all 14 groups. Its added case checks the real SQL response, exact recovery, default exclusion, server rejection of a forged selection, successful handover and retention of the excluded work. All fixtures use synthetic data and roll back the added case.
- All 26 transfer browser scenarios pass across Chromium and WebKit. Every normal preview includes the nullable retained item; its checkbox remains disabled and unchecked. The cases cover ordinary saving, desktop/narrow layouts, delayed/failed portraits, stale previews, lost acknowledgements, explicit recovery after reopening/closure and blocked device storage.
- `npm test`: 1,879 passed, zero failed or skipped.
- Changed-file lint, immutable migration checks and `git diff --check` pass.
- Production build (`next build --webpack`): passed with placeholder credentials. The first sandboxed attempt could not fetch Google Fonts; the rerun with network access completed successfully.
- Full Foundations browser results and hosted checks belong to the PR/release record and must be verified before deployment.

## Performance and limits

The same bounded recovery loop (maximum 200 items and 200,000 serialized characters) accepts one additional scalar value. No allocations, queries, requests, timers, subscriptions or background work are added to the runtime path. The exact saved preview is preserved, so this does not alter the database fingerprint or retry identity.

A local Node 24 comparison used the original and repaired validators on identical valid boolean previews, 2,000 warmups and 80 alternating paired samples of 50 calls. Median milliseconds per validation were 0.00406 → 0.00402 for zero work items, 0.0972 → 0.0992 for 50, and 0.5395 → 0.5352 for 200. Other validation was running on the host; these small fixture observations do not establish production latency or a speed improvement. The runtime change adds no growing work beyond the existing loop.

Authenticated production acceptance, physical devices and sustained use remain unverified. The user's reported error wording and final-submit timing match the rejecting branch; no specific live client's preview was inspected. Revert the application commit to roll back this repair, preserving all data and receipts.
