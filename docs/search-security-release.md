# Search security release evidence

Stage 1 candidate based on `0df589c3a3f62649937846981ec59a4cd51800f4`, branch `codex/search-security`. The primary checkout was clean before work; implementation is isolated in the managed search-security worktree. See `search-security-protocol.md` for the category and field contract.

## Changes and preservation

The unsafe global contact query is replaced by a bounded authorized RPC. Search shares one delivery-scope lookup, gates creation on seller permission only when relevant, limits matching fields, generates canonical destinations, explicitly reserves private catalogues for owner/admin, and fails closed on authorization lookup errors. There is one search route implementation; obsolete query paths, imports, native destinations and field matching are removed. Existing reusable relationship/access helpers remain because other callers use them.

The additive migration creates one server-only read function and changes no existing policy or data. No existing migrations, accepted work, client/user records, stored files, message reads, unread counts or alerts are modified. Install the function before deploying the application. No new indexes or search service are required.

## Validation

- The prior actual GET handler disclosed an unrelated contact to synthetic unassigned staff and offered the creation shortcut to manager-only staff. These cases now pass alongside the other category, revocation, field and fail-closed tests.
- The final security pack contains 23 route behavior tests. Full suite and webpack production build passed with local placeholder credentials; final counts/commit are recorded at handoff.
- Isolated Chromium and WebKit Foundations fixtures passed all 14 groups in each engine, covering desktop/mobile layout, draft departure and existing interactions. This is regression coverage, not authenticated search UI acceptance.
- Twelve isolated contact SQL groups pass against the actual current conversation policy. Current onboarding-review/queue access SQL regression also passes. Hosted CI includes the new SQL checks.
- Synthetic 1,000/10,000-row query plans return exactly 60 channel candidates, use the existing canonical client-link index, and perform at most 60 conversation checks. Seven interleaved observations per size measured secure RPC medians 0.944/0.878 ms against unsafe candidate reads of 0.038/0.040 ms. Permission checking adds bounded database work; this is not an end-to-end speed claim. Sparse inactive history does not enlarge the candidate scan.
- A synthetic execution comparison uses the actual old/new routes and shared access code at 1 and 500 relationship/client/work/channel records. Ordinary staff reads change from 12 requests/8 dependency waves to 11/4; ordinary admin remains 20 requests and changes 8 waves to 7. Creation-action search adds one necessary admin seller check (20 to 21 requests), still 7 waves. This proves request structure, not production latency. The broad relationship/client reads are unchanged.
- A read-only production OpenAPI preflight confirmed the required existing scope/seller/conversation RPCs and channel fields. The new RPC was absent before installation. Exact policy/index/grant checks and installation are separate release steps.

No live client records, messages or writes are used as test fixtures. Authenticated isolated-workspace search acceptance, physical Android/iPhone behavior and sustained-session production latency are not established by these checks. Existing sampling limits, ranking and client stale-query/error presentation remain for later passes.

## Deployment and rollback

The checksum-recorded installation pack is `/private/tmp/be-search-security-release`. Its preflight is metadata-only; installation checks the reviewed conversation-policy body and existing indexes before creating the function, with bounded lock/statement timeouts. Source/build/CI success does not imply the migration is installed or the app is deployed.

Advance main only to the exact hosted-CI candidate, verify the terminal production deployment and read-only HTTP smoke, then fast-forward the clean primary checkout. Preserve unrelated concurrent work. Report release commit and clean checkout at handoff.

Never roll back to the known disclosure. Retain this security baseline or disable an affected category in a reviewed corrective revision; the additive function may remain. No data rollback is necessary.
