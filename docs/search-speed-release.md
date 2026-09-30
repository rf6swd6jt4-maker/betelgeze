# Search speed pass

Base: `bf74a26d4f514cb17737aeb56b4581e758943a88`. Candidate branch: `codex/search-retrieval`.

## Ownership and security

After the existing verified-session, AAL2 and MFA-reenrollment checks, search uses one service-role-only `search_workspace_records` call. That call verifies current membership in an active workspace, derives only the capabilities used by search navigation, applies the canonical relationship/work-item/conversation policies and returns compact display fields. The actor is always taken from the server session. Private categories remain owner/admin-only; that role never bypasses conversation participation. A search hit grants no destination access: each destination retains its independent guard.

The API validates the returned workspace, role, capability names, field types, UUIDs and category limits before publishing any result. Unexpected private staff rows, malformed responses and database failures fail closed. URLs are built from canonical identifiers in the application; stored URLs, provider identifiers, full revision definitions and storage keys are not forwarded. Session/MFA checks, request cancellation, server/browser deadlines, scope echoes, explicit errors and private/no-store responses remain. There is no private result cache, new prefetch or background request.

## Scope and replacement

This is a speed pass for current discovery. The initial proposal to search every private record and revision failed the database CPU comparison and is not eligible for release. The user verified the production Data API Max rows setting as **1,000**. Existing discovery windows are retained where widening them would increase database work; related destinations, relevance ranking, pagination and complete historical retrieval remain a separate measured change. The final result cap remains twenty.

The new database snapshot replaces broad application record transfers and whole-workspace delivery-scope enumeration. Navigation still uses the shared panel registry. Search no longer loads service definitions merely to derive the unused Appointment Setting capability. Matching and projection occur before records cross the database/API boundary. Unicode root casing preserves the existing Greek, Turkish and accented-name behavior; wildcard characters are literal.

The superseded category queries, application-side record matching/revision maps, request fan-out queue and its unused tests are removed. The old stage-II route benchmark is retired; its exact source and historical measurements remain available at the base commit. Shared access helpers remain for their other callers. The installed stage-I contact RPC remains for compatible rollback and older application deployments; the new route does not call it. No historical migration, client/user row, stored file, accepted work, read receipt or alert behavior changes.

## Evidence and release status

The final migration SHA256 is `de9fe722e783bb0c2f4642a7ede5ce58fa7150d40fdfd8cc7dadffd424a6a1dd`. Reproduce correctness with `BE_PGLITE_ROOT=<optional-runtime> node scripts/validate-workspace-search-retrieval.mjs`; add `--measure` for the 1,000/10,000-record comparison. `SEARCH_RETRIEVAL_SIZES=1000 SEARCH_RETRIEVAL_REVISIONS=30` measures deeper revision history. The optional pinned runtime is PGlite 0.5.8, PostgreSQL 18.3, installed outside application dependencies. CI runs the correctness gate. The fixture omits the unused composite activity index absent from production; its replacement single-client index is also omitted because neither search path uses it. The report records both fixture and migration hashes.

The baseline is the complete prior search path after authentication: workspace/membership, capability setup, category reads, contact RPC and staff delivery-scope RPC. The user verified the baseline Data API ceiling as 1,000. Measurements include database JSON serialization, with five timed samples after warm-up per path; old independent-query medians are summed, so they are resource comparisons, **not wall-clock request latency**. Query fixtures include misses, common two-character terms, provider matches and positive admin/assigned-staff hits. The 24 KB module structures are repetitive synthetic strings; service definitions are 512 bytes, with three revisions per parent.

| Synthetic fixture / actor | Previous database + JSON, ms | Replacement, ms | Search database calls |
| --- | ---: | ---: | ---: |
| 1,000 records/category, admin | 28.80 | 17.53–19.35 | 19 → 1 |
| 10,000 records/category, admin | 97.52 | 63.67–71.48 | 19 → 1 |
| 10,000 records/category, unassigned staff | 1,336.26 | 7.94–43.26 | 11 → 1 |
| 10,000 records/category, assigned staff | 1,384.55 | 9.52–43.65 | 13 → 1 |
| 1,000 parents, 30 revisions each, admin | 69.18 | 44.22–49.42 | 19 → 1 |

At 10,000 records/category, synthetic database-to-server payloads fall from 6.32 MB to 529–9,150 bytes for admin, 611 KB to 365 bytes for denied staff searches, and 1.28 MB to 528 bytes for assigned-staff hits. The unchanged Auth/MFA provider work is excluded from both sides. No new index, generated column, trigger or stored projection means no added per-record write maintenance. The first all-record private-scan prototype and its set-based revision alternative were rejected; lower transfer alone did not excuse their higher database CPU.

Seven SQL correctness groups execute the latest actual policies, including current onboarding-review scope, membership/assignment/chat revocation, every role, cross-workspace IDs, role grants, literal wildcard/Unicode handling, exact projections, retained source-window exclusions, authorized final limits, old legacy-client mapping, and more than 1,000 tied-timestamp clients containing a forged foreign relationship link. The HTTP tests independently cover session-derived actor, malformed snapshots, canonical URLs, private categories, no partial errors, cancellation, deadlines and scope echoes. Previously unspecified result ties use deterministic IDs; discovery limits remain explicit.

Local application checks: 1,375 repository tests, changed-file ESLint/migration-history/whitespace checks and production webpack build. Browser foundations passed 273/273 cases per engine in Chromium and WebKit, including the 96 existing desktop/mobile search lifecycle cases. No existing client records were used as test traffic.

Detailed artifacts are in `/private/tmp/be-search-speed-release`. Hosted exact-commit CI, migration installation, terminal deployment and HTTP smoke are separate rollout evidence. These in-memory database/browser checks omit network, cold disk, concurrency and full production schema; they do not establish authenticated production latency, physical-device behavior or sustained-session stability. No isolated authenticated production workspace or physical device was exercised.

## Installation and rollback

Install the additive function before deploying its caller. The guarded release artifacts check existing policy bodies, indexes, ICU behavior and server-only grants without reading business records. Never replay historical migrations to satisfy a failed preflight. The first installer stopped before function creation because it required an unused historical activity index. User-supplied catalog results from production PostgreSQL 17.6 confirmed the other 27 reviewed indexes, matching ICU versions and the required Unicode behavior. The corrected installer removes only that unsupported index prerequisite; policy fingerprints, collation and service-role-only grants remain guarded. No index is added or repaired by this release. The original GitHub checkout path remains unchanged.

Rollback application code to the stage-II base above; its security repair and contact function remain compatible. Leave the additive read-only function installed. No data/schema rollback or client-history deletion is needed. Keep the candidate and primary checkouts clean after release.
