# Free client GHL connections

Base: `bd1564c3feccf01dc04e7429acd6ed8fbecaf946`. Authorized on 12 October 2026, including deployment. The user selected the bounded relationship lookup after the first synthetic list benchmark exposed a regression; that first query was discarded.

Owners/admins can connect an unarchived client with an active, non-imported service instance in onboarding, setup or maintenance, regardless of template. Legacy onboarding/retention clients and previous Appointment Setting eligibility remain compatible. Existing saved connections stay manageable after service completion. Staff grants retain their current policy; free eligibility does not grant staff access to additional relationships.

Client portal GHL selection now follows a stored connection with a saved credential. A connected client sees GHL even if their frozen onboarding includes Appointment Setting blocks. Without a connection, native appointment history retains its existing fallback and other clients see the empty state. Neither service identity nor onboarding completion establishes a GHL connection. No sale, session, credential, historical appointment, notification, provider subscription or client record is rewritten.

The live read-only check found Bruce Laing has an active service instance in onboarding while the legacy relationship phase remains potential_client. The isolated fixture explicitly reproduces this case. It does not prove Bruce's provider credentials or connection have been verified.

## Owners and compatibility

- `manage_client_ghl_connection` retains its Vault, lease and staff authorization implementation. Owner list results are capped at 1,000 with an explicit error above the cap; exact relationship routes continue to work. No silent truncation. Existing staff list scope/query is preserved.
- `manage_client_ghl_connection_v2` authorizes a credential/calendar/save operation using the exact target instead of enumerating the whole workspace.
- Save/refresh/remove actions default to complete list responses for older open tabs. Updated tabs explicitly request a targeted response and merge it without discarding other clients. Route snapshot changes retain editor state and choices.
- `client_portal_overview` joins the saved connection into its existing session query. It remains callable only by service_role, with an explicit JWT-role guard and empty search_path under SECURITY DEFINER. No private table permissions or token decryption are added. Revoked/invalid session tests and function/table privilege tests cover this boundary.
- Relationship context reuses existing service data for the owner/admin shortcut. No added shell request, subscription or timer.

## Validation

`validate-free-client-ghl-sql.mjs` applies the actual historical RPCs and new migration in isolated PGlite/PostgreSQL with synthetic Vault data. It covers free onboarding with a legacy potential_client phase, owner access, staff/cross-workspace denial, exact credential reads, calendar save, connection precedence over frozen blocks, removal/stale revision rejection, preserved native-history fallback, archived/inactive/revoked access, existing connections after service completion, and the 1,000-client bound. The same fixture passed against the exact three production function definitions downloaded read-only. Foundations now runs it in CI.

Thirty warmed alternating samples per arm at about 500 synthetic clients, PostgreSQL EXPLAIN ANALYZE execution times in milliseconds:

| Path | Baseline median | Candidate median | Baseline p95 | Candidate p95 |
| --- | ---: | ---: | ---: | ---: |
| Legacy owner list | 2.669 | 2.442 | 2.747 | 2.715 |
| Legacy staff list | 0.101 | 0.102 | 0.110 | 0.112 |
| Legacy credential check | 2.703 | 0.080 | 2.830 | 0.113 |
| Legacy portal overview | 0.048 | 0.048 | 0.063 | 0.054 |
| Service-instance owner list | 2.623 | 2.639 | 2.717 | 2.703 |
| Service-instance staff list | 2.662 | 2.660 | 2.719 | 2.729 |
| Service-instance credential check | 2.722 | 0.106 | 2.993 | 0.204 |
| Service-instance portal overview | 0.045 | 0.045 | 0.059 | 0.054 |

The small list differences overlap observed run variation; no recurring regression remains. These are synthetic database timings, not production/network/provider or physical-device performance. No indexes, triggers, stored projections, background work or provider requests are added. A targeted mutation response is bounded to one account. The broader owner list necessarily includes the newly eligible clients; its cap prevents unbounded transfer.

Local full-suite/build/lint and Chromium/WebKit foundation and client-connection checks accompany the candidate. Client-connection fixtures cover desktop/mobile widths, calendar editing, retained tokens, confirmed/cancelled removal, and preservation of another client under targeted updates. A mixed-version action test covers old/new response scope. Local native concurrency could not complete because the available embedded PostgreSQL distribution lacks psql; the required hosted PostgreSQL 16 job must pass before promotion.

## Release and rollback

Install only `20261012210000_free_client_ghl_connections.sql`, with a transaction, lock/statement deadlines, exact pre-install function fingerprints and migration-history guard. Verify all three resulting function bodies against the rehearsed candidate and retain the existing EXECUTE ACLs. Do not replay historical migrations. Promote the exact candidate only after hosted checks pass and verify the terminal production deployment plus read-only HTTP smoke results. Report hosted/deployment results separately after execution.

The database change is compatible with the previous application and existing open tabs. Application rollback can restore the base while retaining this migration and all connections. Any later SQL rollback must preserve the newly saved free-client connections and their management access; do not restore an Appointment Setting-only gate over them. No real client/provider mutation or physical-device test was used for validation.
