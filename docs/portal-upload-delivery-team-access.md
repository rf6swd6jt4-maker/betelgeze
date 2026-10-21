# Portal uploads: current delivery-team access

Date: 2026-10-21. Original investigation base: `64f67633`. Release base: `9c3340ae3922c3aec1958ab204a35f9b4e6fdc6c`. The user explicitly approved the disclosed denied-access speed tradeoff and deployment after validation; `app_speed.md` records the narrow allowance.

## Cause and correction

The canonical asset read owner required full relationship coverage or independently accessible linked work. It omitted the designated client delivery-team roster. A bounded read-only production investigation confirmed that staff team members could open the conversation but could not resolve portal-upload references. Upload notifications and original storage objects were present. Client-identifying details and production record identities are intentionally excluded from this public repository; the committed test evidence uses synthetic data.

The additive migration `20261021180000_portal_upload_delivery_team_access.sql` extends that same owner. A staff member must currently belong to the active workspace and the client's nonarchived designated relationship team. The client must be nonarchived. The asset must be a genuine portal upload with its original relationship metadata matching a canonical same-workspace link. Selected-service onboarding remains exclusively controlled by its existing module gate. Existing owner/admin, relationship-coverage and linked-work grants remain intact.

Existing references use the same owner, as do asset RLS, standard/resident asset detail, private preview and downloads. No backfill, reupload, file copy or stored-message rewrite is needed. Relationship details, notes, asset writes, other clients and cross-workspace access retain independent restrictions. Generic chat membership adds no grant. Existing reference caches may require chat reactivation or refresh; previously issued signed URLs retain their current expiry behavior.

## Speed

The function reuses an exact asset lookup and function-local generic plans. All added joins use existing indexes; no new browser requests, startup JavaScript, indexes, writes, subscriptions or jobs are introduced. The migration checks the existing function hash and valid/ready lookup indexes before replacing the owner inside one transaction with bounded lock/statement timeouts.

Final isolated PGlite PostgreSQL measurement: 20,000 synthetic relationships/teams/assets/links, 15 warmups and 60 alternating samples per cohort, 40 checks per sample. The denied portal path adds 0.881 ms median per batch, within the approximately 0.95 ms tradeoff disclosed and approved. Gains in other cohorts do not cancel this cost.

| Cohort | Baseline median / p95 ms | Candidate median / p95 ms |
| --- | --- | --- |
| owner | 1.295 / 1.582 | 0.418 / 0.512 |
| team portal | 3.879 / 4.07 | 2.467 / 2.61 |
| other team denied | 3.889 / 4.145 | 4.77 / 5.006 |
| manual asset denied | 6.42 / 6.597 | 5.964 / 6.245 |
| selected service denied | 4.913 / 4.943 | 4.34 / 4.39 |
| legacy seller allowed | 3.409 / 3.436 | 2.951 / 2.975 |
| legacy linked work allowed | 6.483 / 6.692 | 6.016 / 6.282 |
| legacy selected module allowed | 5.104 / 5.19 | 4.494 / 4.713 |
| offboarded actor | 1.409 / 1.437 | 0.346 / 0.353 |

[Raw samples and indexed plan](portal-upload-access-review/isolated-performance.json) are database-only measurements, not production page latency. Each growing table uses an indexed exact lookup visiting at most one row in the inspected portal-join plan.

## Verification and evidence boundaries

- Before the concurrent main update: 1,698 repository tests, changed-file/foundation lint, production webpack build, all Chromium/WebKit foundation scenarios, and all eight Asset Library desktop/mobile/save-picker cohorts passed.
- Final dedicated SQL regression: seven groups passed. Coverage includes the failing baseline, assigned/manual current members, existing references, actual asset RLS, reference RPC, MFA/reenrollment, null/anonymous actors, workspace/team removal, status/archive changes, malformed provenance, canonical-link removal, write denial, independent seller/work/module grants and guarded installer drift rejection.
- Actual reference adapter, SQL authorization, RLS and private preview/download adapter pass with synthetic signing. Authorized members receive canonical references and private no-store 303 downloads. The wrong team and removed members cannot obtain fresh signed originals.
- Existing Library and reference SQL packs passed with their historical policy loaders. The new dedicated suite explicitly installs the final migration; it does not mistake the historical loader for candidate coverage.
- Production read-only preflight matched source function MD5 `70c49c60615c5e7839296a6994f377cd`, stable/security-definer attributes and required indexes. Recheck immediately before installation.
- Final combined-candidate full tests/build/lint and same-SHA hosted Foundations checks are mandatory before production advancement. Hosted checks include both browser engines and isolated native PostgreSQL. Production installation, exact deployment status and post-release reference checks must be recorded separately; they are not established by this document's local results.

Commands for the new checks (optional pinned PGlite 0.5.8 runtime installed outside application dependencies):

```sh
BE_PGLITE_ROOT=/path/to/pglite node scripts/validate-portal-upload-team-access.mjs
BE_PGLITE_ROOT=/path/to/pglite node scripts/validate-portal-upload-download.mjs
BE_PGLITE_ROOT=/path/to/pglite node scripts/measure-portal-upload-team-access.mjs
```

Browser fixtures and synthetic signing do not establish authenticated production UI or physical-device behavior. No physical-device or sustained-session stability claim is made.

## Release and recovery

After the exact combined candidate passes hosted checks, install the guarded SQL once, verify the live function and current-user reference decisions, then advance main without force and confirm its exact production SHA reaches READY. Preserve existing client records and storage throughout. If a corrective rollback is necessary, restore the previous canonical function through a new guarded migration; do not delete immutable migration history or modify client data.
