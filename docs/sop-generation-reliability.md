# SOP generation reliability — 2026-09-15

## Changes

- Input IDs determine their source ownership. Restore missing references from these IDs, deduplicate within one request, and allow up to the source's bounded 80 steps. Unknown references and duplicate requests across tasks still fail. No procedural content is inferred by this repair.
- Optional attachment suggestions must pass the existing scope and quote validators. Invalid suggestions are omitted with a warning; the original SOP stays attached. Publication still rejects revoked or changed assets atomically.
- Service add/change commands awaiting generation are private intents. Existing service stages remain unchanged; a new service is created only inside successful work publication. Ordinary service validation runs inside a rolled-back subtransaction before accepting the intent, and runs again on publication. Version checks reject concurrent edits. Automatic onboarding readiness uses the same staging boundary for the existing test-only SOP rollout.
- Failed runs retain their output and diagnostics. Saved valid plans remain reusable. No automatic paid retries are added. Lost publication acknowledgements are reconciled against durable status.
- Work errors are specific, bounded to 160 Unicode code points and shown on one visual line with ellipsis. Full bounded text is available in the title. Arbitrary provider or database payloads are not exposed.

## Performance and rollout

No additional provider call, polling timer or foreground network round trip. Pure input/attachment validation remains bounded by existing source/task limits. Publication evidence remains bounded to roughly 12,000 quote characters per task despite the larger reference count. Staging adds one private indexed intent and reuses existing durable work requests. Ordinary service creation validation is rolled back before acceptance; no work items, notifications or service-history writes escape that subtransaction.

The database migration must precede application deployment. It preserves old worker compatibility, the previous source version, and existing saved plans. No existing failed services are deleted or retrospectively moved. Pending commands and failed work are retained for explicit recovery.

## Verification

- Exact saved failed response replayed locally: all 12 tasks retained; first request now references steps 1–13. All 16 unsupported optional attachment suggestions omitted; zero provider calls and zero production writes. Local repair/validation observation: about 1 ms, not an end-to-end latency claim.
- Application tests cover reference repair, preserved unknown-reference rejection, provider refusal/output exhaustion/empty output, compact Unicode errors, optional asset omission, invalid saved plans, and lost publication acknowledgements.
- PGlite exercises actual service command functions and SOP publication, with isolated authorization/readiness fixtures: staged add/change replay, failure rollback, no premature stage events, thirteen-source-step publication, stale version rejection, repeated automatic onboarding events and private-table access denial. Existing source/asset scope and transaction tests also run.
- Production build and repository suite are required before release. These checks do not claim authenticated production UI or physical-device validation.

## Recovery

Application rollback can restore the previous worker without dropping the new database tables or private intent records. Do not reverse staging while pending intents exist: doing so would lose pending service commands or publish them early. Retain failed run diagnostics and retry explicitly only after correcting the reported issue. Publication failures leave the intent and paid plan available; provider retries retain the existing attempt and daily-budget limits.
