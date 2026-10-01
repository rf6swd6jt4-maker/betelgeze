# Library authorization repair — 1 October 2026

## Scope and confirmed defects

The existing server action allowed a staff user with asset read access to update shared asset metadata with the service client. The legacy detail page also showed editing controls to that user. Both now follow the existing owner/admin database write policy. The session client enforces that policy again at the UPDATE; optimistic version checks and accepted data remain intact.

Shared attachment lists authorized the parent, then fetched and signed all linked records with the service client. A readable work item does not grant access to an attachment from a different selected-service onboarding module, or to an admin-only note. The target/link reads now use the verified cookie session and existing database policies. This applies to both native and legacy asset details, work-item attachments, private resource downloads, the workspace asset list, and the shared attachment endpoint. The workspace-wide asset list and attachment choices retain their current admin-only admission.

Private file previews share `lib/assets/preview.ts`: same-workspace storage paths are required, and private signing cannot fall back to the public branding CDN. Encrypted message and extracted SOP image previews continue using their existing authenticated media endpoints. Previously issued asset-preview URLs can remain valid for their existing one-hour lifetime; private resource download URLs retain their 60-second lifetime; this change does not claim immediate recall of previously issued URLs or remotely change bucket/CDN configuration.

## Bounded reads and failure behavior

Direct asset detail/download reads use point-target RLS instead of collecting every delivery asset ID. Linked destinations independently pass their existing RLS policies. An onboarding return link is emitted only for a readable linked relationship. Actor-bound read errors fail closed with a retryable error instead of becoming a false empty result.

Shared attachment paging preserves its original two parallel link queries, each capped at 21 source rows, followed by at most 20 target IDs per lane. Asset authorization rechecks the exact link and its embedded asset in the second query. Filtering happens inside that fixed candidate set, so 5,000 denied links cannot expand permission evaluation beyond 20 candidates. The existing UI supports an empty page with an Older attachments control. Page progress is encrypted and bound to the workspace/parent, preventing a skipped private target ID from being disclosed through a cursor. Already-open legacy cursors remain accepted as positions only; they grant no record access.

Workspace list limits remain 160 records and 24 previews. This repair does not claim exhaustive discovery or fix the earlier bounded-list completeness limitation. No startup JavaScript, polling, write trigger, index, schema migration, or production mutation was added. Both work-detail callers now leave attachments to the shared paginated `RecordAttachments` owner. The obsolete eager full attachment read, unused native attachment payload, and misleading capped context count are removed. This also removes unused image presigning; avatars retain their existing owner. The asset-detail linked-record paths are unchanged by this cleanup.

## Verification

- 29 affected runtime tests pass, covering metadata roles/CAS/account switch, revoked and failed reads/writes, private download checks, preview path isolation, existing message/SOP media routes, fixed candidate counts, encrypted cursor tamper/parent isolation, and native/legacy work-detail rendering without attachment prefetch.
- `BE_PGLITE_ROOT=/private/tmp/betelgeze-library-sql node scripts/validate-library-authorization.mjs` passes five groups using the real effective membership/MFA/relationship/work/module/asset policy bodies and asset RLS. Optional runtime: `@electric-sql/pglite@0.5.8` installed outside the repository.
- SQL cases include owner/admin, assigned staff, unrelated staff, foreign workspace, selected-service denial despite a readable work link, SOP visuals, private notes, incomplete MFA, missing actor, revoked membership, and admin demotion. A 5,000-denied-link fixture confirms an `asset_work_items_pkey` index scan checks at most 20 candidate links.
- The final integrated **1,407-test suite**, changed-file lint, migration/whitespace gate and production webpack build pass. See [integrated validation](consolidation-validation-2026-10-01.md). Standalone `tsc` encountered pre-existing test import/type errors in the initial workstream run; the integrated production build is the application compile evidence.

These are source, runtime-fixture and isolated-database results. They establish bounded query shape and policy behavior, not production latency, concurrent load, authenticated production UX, or physical-device acceptance. No production read/write/migration or deployment was performed. The normal release gate must still verify the integrated candidate, an isolated authenticated owner/staff workflow, and matched warm/cold interaction behavior. Rollback the application commit if needed; there is no schema/data rollback.
