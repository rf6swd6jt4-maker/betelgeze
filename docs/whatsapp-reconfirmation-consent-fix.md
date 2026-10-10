# WhatsApp reconfirmation consent compatibility

## Scope and behavior

Base: `6d261157` (`fix: identify denied HighLevel connection checks`).

The Communications reconfirmation endpoint rejected a contact outside the 24-hour response window when a channel-selected sale recorded `consent_confirmed_at` and a WhatsApp delivery choice but no inbound confirmation-message ID. The shared messaging-choice lookup requires that linked reply, so the composer offered reconfirmation while the endpoint rejected it before contacting Meta.

Keep the existing messaging-choice check. When it has no matching confirmation, inspect only the latest confirmed sale for the same workspace and relationship. Accept its evidence for the reconfirmation template only when `confirmation_source` is `relationship_channels` and its saved delivery choices include the current WhatsApp number. A revoked contact confirmation cannot use this fallback. Missing or mismatched evidence fails closed; lookup failures remain errors.

The endpoint continues to require conversation access, an active relationship, no WhatsApp opt-out, a closed response window, and a saved validated reconfirmation template. Existing message request IDs, database duplicate protection, delivery handling and provider errors remain in place. Freeform eligibility, inbound handling, alerts, read state and shared consent lookup semantics are unchanged. No migration, consent backfill or production data repair is needed.

## Speed assessment

No additional chat-loading, startup, typing, subscription or background work. Contacts already accepted by the original consent check make no additional request. The formerly rejected channel-selected confirmation path adds one scoped metadata read before continuing to the existing template delivery path.

The fallback selects only the confirmation timestamp and two JSON metadata fields, filters non-null confirmation timestamps, orders by that timestamp descending and limits the result to one sale. It uses the existing `relationship_sale_confirmation_lookup` partial index. An isolated PGlite/PostgreSQL fixture with 20,000 confirmed sales in one relationship used that index, read one row and returned one row (`EXPLAIN ANALYZE`: 0.262 ms, one observation). This establishes bounded query work, not production end-to-end latency. No index or write-maintenance cost is added.

## Validation

- Route execution regression covers expired-window delivery without a reply ID; unchanged confirmed-contact request count; workspace/relationship, channel and number isolation; missing/malformed evidence; latest-sale selection; opt-out/revocation; open windows; archived/inaccessible relationships; lookup errors; unverified templates; duplicate reuse; and provider failure.
- `npm test`: 1,540 passed, zero failures after the final runtime change.
- `node scripts/check-foundation-changes.mjs --base HEAD --lint`: passed.
- `npx next build --webpack`: passed after correcting JSON value type narrowing.
- Isolated `scripts/validate-whatsapp-handoffs-sql.mjs`: passed window/opt-out, duplicate reconfirmation, warnings, portal reuse and engagement checks.
- Read-only production lookup confirmed the affected relationship's latest sale matches the fallback. Saved connection metadata identifies `scaylup_service_updates_preference`, language `en`, last verified on 2026-09-21. Current Meta acceptance has not been tested.
- Full `scripts/browser/run-foundations.mjs`: 325/325 assertions in Chromium and 325/325 in WebKit, zero failed fixtures. Browser tooling installation and engine verification completed. The initial sandboxed browser launch failed at macOS process registration; the permitted run outside the sandbox passed. These synthetic checks do not establish authenticated delivery or physical-device behavior.

## Release boundary

The user explicitly approved production deployment on 2026-10-10. Publish the candidate branch and require its exact-commit hosted checks to pass before advancing main; then verify the production deployment and read-only HTTP smoke results. No WhatsApp message is sent as part of release validation. Authenticated template delivery and physical Android/Chrome and iPhone/Safari checks remain unverified. Rollback is application-only; preserve all messages, sales, consent evidence and migrations.
