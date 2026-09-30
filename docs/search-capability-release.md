# Search capability pass

Base: `b789dca41a9ffb145e69e34235ac0e471060cacb`. Candidate branch: `codex/search-capability`.

## Behavior

Search keeps one fresh actor-bound database snapshot after verified session/MFA checks. Direct ID and name matches precede prefixes, other identity matches, permitted related destinations and contextual mentions. Ranking and canonical destination deduplication happen before the twenty-result response cap. Names are not identities: distinct same-name relationships remain separate. Archived relationships, work items, assets, modules and services always appear below active matches and carry the shared grey Archived status. A background-field hit identifies its source, such as “Matches notes.”

Queries of at least three characters may expand the best identity-match tier only when that tier contains one or two readable, non-archived canonical relationships. Broader ambiguous terms skip related discovery. Each selected relationship may contribute one onboarding destination, one client chat, one Team chat and up to two actionable open work items per relationship. Discovery examines only the latest 80 work links and 20 onboarding sessions per seed before usefulness/access filtering, as explicitly selected by the user after the full-history variant failed its performance gate. Older records remain available in their full panels; denied or closed recent records do not authorize scanning further back. Existing client aliases resolve to canonical relationships rather than becoming duplicate Relationship results. A canonical archive status cannot be bypassed by its still-active legacy client record. No records are merged, deleted or rewritten.

Related discovery uses exact relationship links, so those destinations are not restricted to the generic work/contact search samples. Current relationship/client discovery windows and other category windows remain explicit. This is focused relationship retrieval, not exhaustive workspace history, message-body, attachment-content or document search. The attempted full-workspace text scan regressed common staff searches in a paired isolated comparison and was rejected before runtime integration. A later uncapped linked-history prototype also failed: 10,000 linked records raised one staff query from about 4 ms to 449 ms. That approach was stopped, and the user selected bounded recent suggestions. Neither rejected approach was deployed.

## Permissions and destinations

Every seed is a readable canonical relationship. Each related destination independently checks its existing policy in the same snapshot:

- Onboarding also requires its panel capability and a permitted full session or session module. Prefer active, non-archived sessions; use completed sessions only if no active session is readable. One permitted session in the recent window links directly; several use the existing chooser. Session tokens, responses and definitions never enter search.
- Client chat uses the current client-conversation policy for every role. Team chat uses the native-conversation policy and current Team membership. No owner/admin bypass and no conversation creation, message reading, decryption or alert changes.
- Work uses canonical work-item access, visibility/private-area rules and the existing actionable-open predicate. Completed, canceled, archived, automatic and container work are excluded from related suggestions. Existing work-item destination guards remain authoritative.

The API rejects an old/malformed snapshot, invalid relevance/status values, unrelated or archived seeds, excessive per-seed destinations and private staff work. URLs are built from validated canonical IDs. The browser validates the optional archive and match-reason fields; stale-query fencing, cancellation, deadlines, retry, account/workspace scoping and private/no-store responses remain unchanged.

## Replacement and rollout

The new migration replaces the current search function in place and keeps its old response arrays compatible with the prior application during rollout/rollback. The superseded client-result loop and broad navigation map are removed from the current owner. Historical migrations remain immutable. No parallel permission system, private cache, message search or background task is introduced.

Install the guarded replacement before its caller. Validate exact policy/index dependencies against deployed metadata, rehearse against synthetic data, pass the release gate on the exact candidate commit, then verify terminal deployment and read-only HTTP smoke. Roll back application code to the base above without deleting records or database history. Keep primary and candidate checkouts clean.

## Removal inventory

| Retired runtime behavior | Replacement and callers | Preserved dependencies and rollback |
| --- | --- | --- |
| Separate legacy-client result loop and broad client-to-relationship map | The same search RPC resolves matching aliases and activity references through canonical associations; the route receives one relationship identity | All source rows/history survive. Empty `clients: []` preserves the b789 parser; no client query or result loop survives in the current application |
| Fixed insertion order and static-navigation pre-cap | Shared search ranking orders direct identity, related and contextual results, then deduplicates canonical IDs/destinations before the final 20 cap | Existing result lifecycle, navigation owners and all category permission checks remain. No package dependency is removed |
| Global latest-200 module/service revision sample | Indexed latest revision for each of the existing 100 admitted parents | Existing revision records/indexes and panel boundaries remain; no revision is deleted |

The current route is the sole application caller of `search_workspace_records`; the superseded behavior is replaced in place. Historical migration source and the older secured contact RPC are retained for supported deployment/rollback compatibility, as required by `deprecation-policy.md`. Rollback application commit: `b789dca41a9ffb145e69e34235ac0e471060cacb`.

## Evidence

The user explicitly approved deployment after reviewing the measured bounded search cost and its scope. The acceptance is recorded narrowly in `app_speed.md`; it does not waive regressions in ordinary app operations. Production migration and deployment evidence remain pending below.

- Application: All 1,392 unit tests passed, including the final short-ID alignment and 11 focused ranking/payload cases. Production webpack build passed with local placeholder credentials. Foundation source/migration/lint checks passed.
- Browser: all 275 foundation cases passed in each of Chromium and WebKit, including 25 search cases per desktop/mobile viewport. These use actual component/helper fixtures with synthetic loopback data, not a signed-in production account or physical devices.
- SQL correctness: nine behavior groups plus the readable early-stop policy-count regression cover the promoted candidate, including real policy/grant checks, permission revocation, cross-workspace links, partial onboarding access, denied candidates preceding/interleaving readable work, archive status and source-window boundaries.
- Promoted SQL: SHA256 `0f187d9d5e447689269a32eab2766d55247ada25f76e6fbd869715b58c7620ce`. It reuses only the seed relationship's same-snapshot admission, independently authorizes each destination, and orders bounded candidates before applying policy/authorized output limits. Non-UUID queries skip impossible UUID matching. The exact measured bytes are now the candidate migration; the user approved the disclosed cost before promotion.
- Whole-RPC comparison: eleven alternating warmed observations per case in isolated PostgreSQL 18/PGlite, real repository policies/indexes, 1,000/10,000-category growth and up to 10,000 linked histories. At 10,000 linked rows, readable assigned-staff search measured 4.17 → 4.83 ms; mostly-denied assigned-staff search measured 4.16 → 7.16 ms. Admin cases improved from about 34 → 17 ms. Readable selection can stop after enough permitted rows; denied selection remains bounded at 80 work and 20 session candidates. With 1,000 parents and 30 revisions each, admin common-query time improved from 22.58 → 11.11 ms. Ordinary 10,000-row common-query sample ranges overlap (baseline 20.014–20.612 ms; candidate 19.942–20.668 ms), with medians 20.236 → 20.551 ms; this is not claimed as a speed gain. No index, trigger, stored projection or write-path cost is added.

External evidence is retained in `/private/tmp/be-search-capability-release`. Hosted exact-commit CI, guarded installation, terminal deployment and production smoke remain pending. Database observations do not establish authenticated production latency or physical-device behavior, and the remaining per-action cost is not labelled a speed improvement.
