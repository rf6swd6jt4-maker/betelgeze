# Incoming WhatsApp phone matching and Bruce message recovery

20 October 2026. Base: `9586f594f0e27ed5ec685b4e96af10f3d6c5f755`.

## Cause and repair

The Meta webhook normalized the sender but compared it with the stored relationship phone as exact text. A saved number with spaces, parentheses and a hyphen therefore failed to match its equivalent international number. The four incoming messages were encrypted and retained as `unmatched` with no relationship ID. This also prevented the normal incoming-message path from updating the WhatsApp reply window.

The user authorized restoring the four records, fixing the cause and deploying. A guarded production transaction associated exactly those four original rows with Bruce's existing relationship. It retained message IDs, provider IDs, timestamps, exact bodies and original webhook payloads, re-encrypted both content fields under the existing relationship key, and verified equality before committing. It restored the last-inbound timestamp from the original latest webhook. The repair neither replays webhooks nor creates outbound delivery records. It changes no read cursors, alert jobs, consent, ownership or other clients. Recovery verification found four received rows, the expected relationship key, and no external deliveries. Authenticated Comms showed the four dated entries and the latest original preview; the composer recognized the recovered reply window.

## Application and database ownership

`resolveInboundDestination` now calls one restricted, read-only database function using the existing canonical `relationship_contact_phone` normalizer for both stored and incoming numbers. Two partial expression indexes support current relationships by workspace and normalized WhatsApp/primary phone. Each indexed arm limits candidates to two; the combined output has at most two distinct relationships. A duplicate in both fields of the same relationship counts once. Ambiguous identities remain unmatched and cannot trigger sale confirmation or reply-window updates. Zero candidates preserve existing legacy channel/client fallback. Database failures are raised to the existing webhook diagnostic owner instead of being treated as a successful empty match. The existing webhook acknowledgement policy is unchanged.

Phone formatting is preserved. The schema migration does not modify stored records, provider settings or historical migrations. Existing encryption, UI, Realtime, read, unread and push owners are unchanged. Genuine future inbound messages use their established capture and notification path.

## Performance authorization and evidence

The user explicitly approved the normalized indexes after seeing the small preliminary write cost. The actual-owner SQL fixture checks formatting, international/trunk-zero variants, extensions, workspace/archive isolation, empty/invalid input, duplicate identities and service-role-only execution. It verifies both index plans with roughly 20,000 relationships and bounded indexed resolution with another 10,000 duplicate-number records.

One hundred alternating warmed samples per arm measured routing SQL median/p95 1.639/1.703 → 0.038/0.079 ms; phone edits 0.015/0.033 → 0.044/0.082 ms; notes-only edits 0.011/0.020 → 0.012/0.052 ms. These are isolated PostgreSQL/PGlite database observations, not production network or end-user latency. The final canonical normalizer is more complete than the preliminary digits-only index prototype. Storage/write maintenance is the explicitly accepted tradeoff. There is one relationship lookup request instead of two, bounded candidate transfer and no new foreground Comms work.

## Release gate and rollback

The old resolver fails the new formatted-number regression. Seventeen targeted application cases pass, including confirmation replay preservation and both ordinary/CONFIRM ambiguity handling. SQL behavior, roles and query plans pass. Full application tests, changed-file lint, production webpack build, Chromium/WebKit foundations and exact-commit hosted checks are required before main advances; terminal results are recorded separately.

Production rollout creates each index concurrently as a separate statement, verifies its exact definition and valid/ready state, then installs the function and verifies its service-role grant. Apply the additive migration before deploying the caller. Verify the real sender resolves to the expected relationship through a read-only RPC; do not send a synthetic client message. Confirm exact production deployment SHA/Ready state and HTTP smoke checks separately.

Rollback restores the previous application while retaining original/recovered history, existing ownership, encryption and additive schema. No physical-device or new Meta-delivery claim follows from these checks.

## Local release evidence

All 1,698 repository tests passed, along with changed-file lint, immutable-migration checks, whitespace checks and the production webpack build using loopback placeholder configuration. The production normalizer's body MD5 matches the fixture (`6ced65cde2dc0a482f5f958ccc5ee653`). Preflight found both new indexes and the new function absent, PostgreSQL 17.6, a two-minute statement timeout, and no migration registry; do not create or reconstruct one. The reviewed migration SHA-256 is `d945c142bb07b30a0193dfb17c6a2454cd445220302084e8649bc2d7feb9e245`; the new function body MD5 is `28c3b8408d73e3635d4bfe2296d932bc`.
