# Workspace search: security and capability plan

Prepared 27 September 2026 for a separate implementation task. Investigation baseline: production/main `4ac3abac28a5f649e5e04f781d5109a9cb3e5015`; search/access code is unchanged from `6ba28cb5`. This document authorizes no production data cleanup or expansion of staff permissions. Search remains unchanged in the tab-startup release.

## Confirmed problem and current behavior

`app/api/workspaces/[workspaceSlug]/search/route.ts` requires an authenticated AAL2 user, an active workspace and workspace membership. It then uses `supabaseAdmin`, so application/RPC authorization must restrict every result; ordinary row-level security is not the protection for these reads.

Relationships and work items use `accessibleRelationshipIds` and `accessibleWorkItemIds`. Contact channels do not: any staff member receives `communications.manage` in `loadWorkspaceAccess`, and search queries up to 60 workspace channels and returns matching external addresses, provider names and channel IDs without conversation participation checks. A synthetic execution of the real GET handler returned an unrelated contact to staff with empty relationship/work-item scopes. This is confirmed metadata disclosure, not proof of unrestricted message or attachment access. Existing conversation endpoints separately use `clientConversationCanAccess` and related owners.

The current UI debounces queries for 180 ms, requires two characters and returns at most 20 results. Matching is lowercase substring comparison in JavaScript. It samples many categories before matching (60–100 rows; some revision reads 200), uses fixed category order, lacks pagination/relevance ranking, reads broad relationship/client datasets, silently treats failed searches as no results, and retains old results while a new query loads. Enter can navigate to a result from the preceding query. SOP navigation is searchable, but this is not document-body, SOP-content or message-history search.

## Desired contract

A user may discover only records they can currently open, and only fields permitted for that user. Matching, counts, labels, descriptions, IDs, URLs and suggestions must all obey the same rule. A denied record must not influence visible results or totals. Access changes must take effect on subsequent requests without re-login. Opening a result must recheck current authorization independently.

Search should reliably find authorized records beyond the first page of storage, return useful ranked results with predictable limits, distinguish errors from no matches and never navigate using stale query results. Preserve current workspace, MFA, service-assignment and conversation boundaries; do not introduce another permission system.

## Delivery order

### 1. Contain contact disclosure in a small first release

- Add a behavioral test invoking the actual route with a staff user, zero permitted relationships, and an unrelated matching channel. Establish the failing baseline.
- Choose one narrow containment: omit contact-channel results from ordinary staff search until authorized retrieval exists, or retrieve only channels attached to conversations the actor can access through the existing authoritative conversation scope. Prefer the latter if it can be expressed as a bounded set query without one permission RPC per result.
- Do not assume `communications.manage` or general relationship access grants access to every client conversation. Optional chat members and service assignees must follow the same rule as the actual conversation.
- Preserve legitimate owner/admin behavior and existing participant access. Return only necessary display fields and a useful authorized destination, not a generic Communications link containing unused internal channel IDs.
- Test cross-workspace requests, revoked membership, removed conversation membership, staff with no assignments and multiple unrelated clients. Deploy this independently of ranking work.

### 2. Specify and enforce a category access matrix

| Category | Authoritative scope to trace and reuse | Display/navigation requirements |
| --- | --- | --- |
| Panel/action shortcuts | Current panel registry, role/capabilities and destination action guard | Hide inaccessible shortcuts; a visible shortcut never grants access |
| Relationships | Delivery/relationship scope, operational role and permitted detail surface | Respect partial service access; staff must not receive admin-only commercial/background fields or a broader destination |
| Work and onboarding review items | Current queue/work-item scope, including the latest generated-review assignment rules | Include only items the actor can open; correct native/record destination |
| Client conversation contacts | Current conversation participant/roster scope | Addresses/labels only for readable conversations; no global channel enumeration |
| Notes and assets | Their actual record/attachment scope and current panel eligibility | Avoid leaking private descriptions, signed URLs, tokens or file storage keys |
| SOPs | Existing SOP read policy and published/archived semantics | Decide explicitly whether records are included; do not infer permission from a Library shortcut |
| OKRs, admin activity, service catalogue, builder modules and settings | Their existing private-panel and record guards | Owner/admin-only categories remain private; avoid exposing historical revision internals |

Inventory every selected/matched/output field. Compare each result category with its destination guard and any related service-level visibility. Review both ordinary staff and staff with seller/manager capabilities. Decide archived/test-record visibility explicitly. Unavailable authorization must fail closed, with a visible generic search error rather than fallback to global results.

### 3. Move authorized matching into bounded database reads

- Filter by workspace, actor scope and query before applying a per-category limit. Eliminate full workspace relationship/client reads and arbitrary pre-search samples.
- Reuse existing access functions rather than copying their SQL. Choose a user-scoped/RLS query or a narrowly reviewed RPC with explicit actor/workspace checks; document how privileged calls remain scoped. Derive the actor from the server session, never a request-supplied user ID.
- Use parameterized queries with literal substring escaping if LIKE/ILIKE is used. Bound query length, result count, cursor size and execution time. Define handling for Unicode, punctuation, phone formatting and short IDs.
- Rank exact record ID/name matches first, followed by prefixes and word/substring matches. Use a deterministic tie-breaker. Allocate category slots or group results so shortcuts/relationships do not starve notes or other categories.
- Add only justified indexes after examining query plans on isolated realistic-sized fixtures. Consider trigram/full-text indexing only where measured needs justify it. Do not introduce an external search service or broad private-data index by default.
- Support explicit per-category continuation or a search-results page; cursors must be stable, bounded and validated without accepting arbitrary SQL/order fields.
- Avoid serial query waterfalls and one-access-check-per-row. Preserve a bounded parallel plan. Return a minimal projection; do not download full revision JSON merely to search titles.
- Surface a capped response explicitly if a trustworthy complete result cannot be obtained. Never present arbitrary sampling as exhaustive search.

### 4. Repair the client request lifecycle

- Give each query a request identity. Abort superseded requests and ignore any late result, error or finally handler from an older identity.
- Tie visible/selectable results to the exact query and actor/workspace. Clear or visibly mark preceding results during a new query; Enter must not use them.
- Use explicit idle/loading/results/empty/error states, with retry. Handle authentication/access loss separately from transient failure without leaking error details.
- Define keyboard selection, Escape, focus return, loading announcements, mobile sizing and long-label behavior using shared UI primitives.
- Avoid persistent private search caches. If caching is justified, scope it by actor, workspace, permissions and query, with bounded lifetime and explicit access-change/logout clearing. Set private/no-store response semantics where appropriate.
- Search opening, typing and result selection must preserve resident tabs and drafts; do not create another navigation or mutation owner.

### 5. Regression and security evidence

Use synthetic accounts/records in an isolated database/workspace. Never use real client searches to demonstrate a disclosure and never send messages as validation.

Required authorization cases: unauthenticated; MFA incomplete; no membership; inactive workspace; owner; admin; ordinary unassigned staff; assigned service staff; seller/manager staff; conversation participant without broader relationship access; removed participant; removed service assignment; cross-workspace IDs; archived/test records; admin-only fields; authorization RPC failure. Prove absence of unauthorized text/IDs/URLs in raw JSON, not merely hidden UI. Check source-record mutations and destination access independently.

Required functional cases: matching records beyond every current sample limit; exact/prefix/substring ranking; repeated titles and short-ID collisions; Unicode and phone formatting; multi-category competition; empty query; maximum query length; stable pagination; revoked access between pages; malformed cursor; provider/database errors; stale result arrival; old request abort/finally racing a new request; Enter during pending search; workspace/account switch and popup reopen.

Current source-pattern search tests only assert that access helpers appear in the file. Retain useful structural contracts, but add route-level and isolated SQL behavior tests capable of catching the confirmed contact leak.

Measure request count, scanned/returned rows, payload bytes and plans at representative and larger data sizes. Measure query-to-visible-results and selection-to-painted-destination separately on cold/warm paths. Compare the same fixture before/after. No sub-second or sustained-session claim follows merely from a successful build.

## Explicit scope limits

Do not add message-body search, decrypt bulk histories, ingest documents, expose provider credentials, send communications, alter read/unread/push behavior, rewrite historical migrations or delete client data. Those require separate product/access decisions. Read `app-alerts.md` if implementation touches conversation visibility, reads or protected shared owners; search cleanup alone does not authorize alerts changes.

## Release and handoff

Start from current main in the non-iCloud checkout `~/Developer/betelgeze`; re-read AGENTS.md, app_speed.md, platform ownership and the release gate. Confirm deployed schema rather than assuming repository migrations are installed. Use additive migrations only if needed, with preservation and rollback evidence; do not replay history against production.

Release contact containment first, then authorized retrieval/ranking, then client UX if they cannot be safely combined. Validate exact commits on candidate branches before main, verify terminal production deployment and read-only HTTP smoke, and report authenticated/browser/device evidence separately. Roll back application changes with a compatible revision; never restore the known contact-disclosure path as an unreviewed rollback target. Keep authorization tests blocking future releases.

Suggested task prompt: “Implement docs/search-remediation-plan.md, beginning with the confirmed staff contact-metadata disclosure. Preserve all client/user data and current staff/conversation permissions. Reproduce failures using synthetic fixtures, implement bounded authorized search, repair stale-query/error behavior, and deploy only after the repository release gate passes. Do not expand message-body search or alerts scope.”
