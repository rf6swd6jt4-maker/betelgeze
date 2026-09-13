# Pre-queue cleanup release

13 September 2026. Approved cleanup committed on production after a successful rollback rehearsal. Application changes are ready for deployment.

## Result

- Nine active relationships archived: seven tests plus Eric Kant Controller and Mike Hickman from Lead Gen. Forty reviewed non-Bruce relationship IDs were included when retiring old history.
- 338 work records archived from normal Library lists; 188 previously unfinished records canceled. Completed work retains its completion state and history.
- 78 test-owned assets archived from normal Library lists. Files and billing records were not deleted. Two manual assets, `Damn.jpeg` and `OKR table A`, were preserved because they are not owned by these relationships.
- 23 test onboarding sessions archived with revoked tokens; 11 failed delivery retries canceled; five active test portals revoked. No provider sends, charges, subscription changes, service imports or SOP generation occurred.
- Bruce's active and historical relationships were excluded by immutable IDs. The transaction compared fingerprints of every public base table with a relationship_id for Bruce, his relationship rows, linked work rows and team membership before/after. The assertion passed in rehearsal and commit.
- Original affected relationship, work, asset, onboarding-session, outbox, team and portal rows are retained in `pre_queue_cleanup_20260913.snapshots`, a private schema with no anon/authenticated access and an RLS-enabled table. Recovery must be a scoped, reviewed restoration from these original values; do not blindly overwrite newer work. The operation refuses a second execution because its backup schema already exists.

## App change

Lead lists no longer offer Create relationship on desktop or mobile, and archived relationships are not linked as current leads. The old promotion server action authenticates and redirects to a paused message without reading or inserting a relationship. Existing unrelated Lead Gen functions remain intact.

Native and legacy Library lists share their archive filter in `listWorkspaceWorkItems` and `listWorkspaceAssets`. The filter runs in the database before the existing 160-record limit. Partial indexes preserve ordered active-list access as archived history grows. Authorized detail/history reads remain available; this is visibility archival, not deletion or an authorization shortcut.

## Validation

961 tests passed, changed-file ESLint passed, production Webpack build passed, and git diff checks passed. The exact cleanup and index SQL passed a production rollback rehearsal before commit. This is database verification and local build evidence; authenticated production UI and physical-device QA are not claimed.

Scripts: `scripts/operations/pre-queue-cleanup-20260913.sql` and `supabase/migrations/20260913160000_library_archive_indexes.sql`. The live rehearsal/commit combined the index statements inside the cleanup transaction. All operations are bounded to the reviewed IDs, reject shared work or external dependencies, and preserve protected Bruce data.

## Next milestone

Basic SOP-driven fulfillment targeted Sunday 13 September; readiness for Andy Sambitan's real Google Ads manager by Tuesday evening 15 September; operational MVP by Wednesday 16 September. The Tuesday Plan owns the broader checklist. Lead Gen upgrades remain paused until explicitly re-enabled. Fulfillment generation, queue implementation and onboarding/client-portal UI polish are subsequent work, not completed by this cleanup.
