# GHL appointment processing and prompt recovery

## Diagnosis

The 21 October production test was created at 21:09:04 UTC. GHL's dashboard recorded its first webhook delivery at 21:12:36, HTTP 202; BE durably received it at 21:12:37.29585. The worker rejected the successful exact-appointment GET because live v3 returned `appointment`, while GHL's published schema and the original fixture used `event`. Both envelopes are now supported with the same ID/account/calendar checks; ambiguous or malformed responses fail closed. Signature verification and webhook subscriptions are unchanged.

The existing reconciliation scanned one date/calendar per window turn, alternating with known-ID checks across a 97-day horizon. It was scanning December when the test appointment was booked for tomorrow. An initial-import flag also suppressed newly created appointments encountered during that first long sweep.

## Behavior and bounds

- The signed webhook remains the primary immediate path. Provider delivery delay is outside BE's control.
- Every claimed recovery profile first checks the selected calendars across the existing horizon (seven days back through roughly 90 days ahead), comparing bounded list metadata against the indexed retained snapshots. Only new or changed records get exact-appointment reads.
- At most one profile is claimed per scheduled invocation, with existing due-order fairness, up to ten selected calendars, a 45-second discovery admission deadline, five changed observations, and bounded 1 MiB provider responses / fewer than 1,000 list entries. Newly queued observations are drained in the same invocation, capped at five. Existing backpressure and delivery limits remain.
- With the current two-profile pilot and healthy one-minute scheduler, each profile normally receives a scan every one to two minutes plus request time. This is not an unconditional delivery SLA. More profiles, a backlog, provider delays/errors and large calendar responses lengthen recovery. Wide responses that exceed the bounds expose a profile warning and retain the original narrow/known-ID recovery instead of accepting truncation. Events outside the discovery horizon still depend on webhooks or previously retained IDs.
- Verified creation time is compared to activation/profile creation so fresh bookings are not suppressed as old imports. Existing bookings are not broadcast simply because they are first discovered. A delayed webhook after fallback cannot create a duplicate notice.
- Existing consent, STOP, current number, version, pending-event, template approval and uncertain-send fences remain authoritative. No UI request, browser polling or history fetch was added. The new SQL branch requires the existing profile lease, selected calendar and connection/access checks; it uses existing snapshot/inbox indexes. No schema tables/indexes or client backfills were added.

## Verification

- Corrected production provider parser and wide scan read the unchanged test appointment successfully in 3.65 seconds combined; contact and timezone resolved. Read-only evidence, no send.
- New integrated isolated test runs the actual Ed25519 verifier, provider parser with live-shaped responses, worker and PostgreSQL RPCs through Communications and delivery rows, using a non-network Meta sink. Covers booking, cancellation, duplicate and delayed webhook, missing-webhook same-invocation recovery with a December cursor, unchanged-record suppression, held-recipient sends, historical imports, lease/calendar isolation and the five-observation bound.
- Existing regressions retain 25,000-row unrelated intake/outbox growth checks, consent/STOP, uncertain acknowledgements, stale versions and multi-calendar behavior. Full checks and deployment results are recorded in release evidence, not inferred here.

## Production safety and rollback

Jason's appointment sending was temporarily disabled before the repair so recovery cannot contact him without approval. His GHL appointment and calendar binding were not changed. Restore sending or perform a demo only after explicit permission. Do not automatically replay any provider send with an uncertain acknowledgement.

Apply the additive migration before the application release. An application rollback remains compatible with this migration and leaves history/accepted work intact, but restores the old parser defect and slow discovery; use only for a newly discovered regression. Do not roll back by deleting stored events/messages or by replaying migration history.
