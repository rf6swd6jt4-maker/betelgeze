# Meta reporting readiness and maintenance

This change is prepared for review. No production account has been rebound and no live provider authorization, production migration or deployment has been performed as part of implementation.

## Ownership and behavior

The existing Windsor provider, onboarding block and portal report own the reporting path. Client Connections opens a lazy maintenance dialog for one relationship. Its initial read loads saved metadata and at most ten credential-free audit receipts; it does not call Windsor or add requests to Client Connections startup.

Maintenance stages a separate encrypted client authorization. The live binding remains active while another account is considered. Account discovery uses that client's co-user grant, never the agency's full account list. A selected account must return a valid, account-scoped report before it can be explicitly confirmed. The command rechecks workspace/relationship access, integration fingerprint, candidate actor, expiry, expected revision and exact preview before committing. A repeated candidate receipt reconciles an uncertain acknowledgement without another change or duplicate audit row.

Completed onboarding requirements, source session/block IDs and previously accepted onboarding work are preserved. New staff-created connections may have no onboarding source. Existing connections remain connected and are marked unverified until deliberately reviewed. New onboarding requires explicit account selection, a report preview and business-account confirmation, including when Windsor offers only one account.

Existing authorization attempts used to discard their temporary grant on completion. These legacy accounts need a new Windsor authorization before staff can inspect their client-scoped accounts. New verified completions retain the encrypted grant under the service-only boundary for later review. The browser receives an authorization URL only when the user explicitly starts that flow; stored ciphertext and workspace API credentials never enter the response.

## Report integrity and freshness

Reports request exact start/end dates and `account_id`, cap provider results at 501 rows (more than 500 is rejected), and bound provider JSON to 2 MB. Parsing rejects missing or malformed metrics, error envelopes, wrong-account rows, mixed/missing currencies on populated rows, impossible dates and dates outside the requested period. A successful empty row set is a valid zero-activity report. A missing metric is not interpreted as zero.

The 30-date window ends on the current UTC date and its literal dates appear in the report. Date labels returned by Windsor are preserved. This endpoint does not provide the account timezone, so maintenance explicitly states that it is unavailable. Before release, verify the requested fields and numeric/null behavior against a permitted Windsor fixture or client-approved comparison; do not silently relax missing-metric validation to make an unsupported response pass.

One bounded successful report is stored with the selected account and connection revision by verified setup, maintenance and refresh commands. Warm portal reads return it without a provider request. An uncached first GET returns the provider result without a cache-save round trip; failures on that GET also perform no new write. Explicit or stale-background POST refreshes persist their result. This preserves first-load speed; a legacy account without retained figures continues to use provider reads until an explicit refresh or verification saves its first report.

The mounted active Ads view refreshes stale data once; explicit Refresh remains available. A report becomes stale after 15 minutes or a date-window rollover. There are no new polling timers. Hidden portal sections do not start refreshes. Provider requests share a bounded in-flight map after portal authorization and all pending entries are removed on completion or failure. Read and refresh keys are separate, so a concurrent POST cannot inherit a read-only GET and skip persistence.

On provider failure, the last successful report and its original timestamp remain visible with a warning. Account/integration revision checks fence late persisted refresh writes, and a binding trigger clears incompatible cached reports. The write-free legacy first GET uses the authorized binding read at request start; reload a portal already open during maintenance to pick up a newly selected account. `last_report_attempt_at` and `last_report_error` provide maintenance diagnostics for persisted refreshes. The retrieval timestamp establishes when Windsor successfully answered; it does not claim that Windsor's upstream Meta cache was refreshed at that moment.

## Schema and release prerequisites

Migration `20261022013000_meta_reporting_readiness.sql` depends on the existing Windsor reporting and completion-attempt migrations and `service_assignee_can_setup_client`. It adds nullable metadata columns, two service-only tables, bounded command/read functions and a revision trigger. It does not update existing client rows or immutable migration history. Nullable column additions avoid backfilling all connections. It adds no index to an existing table. The new history table has its own bounded-read index.

The existing unique account constraint remains. New verified commands also serialize and check `act_` aliases using two exact probes of that existing index. There is no new alias index or alias lookup on legacy writes. Existing alias duplicates, if any, are preserved for explicit investigation rather than silently repaired. During a mixed-version rollout, unchanged legacy completion RPCs retain their previous raw-ID uniqueness only: they do not participate in the new canonical-account advisory lock. Complete the application rollout before relying on canonical alias protection across all new onboarding and maintenance commands.

Schema must be installed before the new application. Keep old completion functions for deployed callers. Application rollback leaves selected accounts, accepted receipts, retained grants and reports in place; do not drop tables, revert client bindings or rewrite completed onboarding to roll back UI behavior. Older application code will continue to read the active connection through its previous provider path.

## Verification

- `node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/windsor-provider.test.ts tests/windsor-completion.test.ts tests/windsor-meta-ads-reporting.test.ts tests/meta-reporting-maintenance.test.ts tests/meta-reporting-cache.test.ts tests/client-portal.test.ts`
- `BE_PGLITE_ROOT=/path/to/isolated/pglite node scripts/validate-meta-reporting-sql.mjs`
- Native PostgreSQL rehearsal: `BE_GHL_NATIVE_PG=1 BE_RECORDS_PG_BIN=/reviewed/postgresql/bin BE_PG_ROOT=/path/to/pg BE_PGLITE_ROOT=/path/to/isolated/pglite node scripts/validate-meta-reporting-sql.mjs`. This starts a fresh socket-only synthetic cluster and additionally checks concurrent commits after a real lock wait. It never accepts a production database URL. The local PostgreSQL 18.4 run passed all 13 checks, including independent-connection contention; hosted PostgreSQL 16 CI remains a separate check.
- `node scripts/validate-windsor-browser.mjs` exercises the actual onboarding, maintenance and portal components in a local fixture with all non-loopback network traffic blocked, using Chromium/WebKit at desktop and mobile widths. It checks explicit confirmation, preserved live selection until save, lost-acknowledgement recovery, retained report failure/retry, hidden-view inactivity, layout overflow and browser errors.

Synthetic fixtures establish bounded behavior and correctness, not production speed or live provider acceptance. Physical Android/iPhone interaction, authenticated deployed UI, real account selection and production reporting comparisons remain separate release checks. No automatic client-wide provider audit or recurring reporting monitor is enabled by this change.
