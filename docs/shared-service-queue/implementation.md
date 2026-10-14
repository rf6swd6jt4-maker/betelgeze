# Shared service queue

Authorized 14 October 2026: multiple assignees, one existing work queue and the existing internal client group; preserve work/history, validate security/concurrency and deploy. The user's Bruce Google Ads test is reserved for them. Read-only production lookup identified its native active Onboarding instance; no client mutations are part of fixtures.

Owners: service-instance membership commands; canonical work/module access; personal queue reader/command; existing Team roster and chat policies. Keep the existing primary assignee for legacy compatibility and add equal operational members. No copied work, changed sale/onboarding snapshots or broad client backfill.

Assessment: extra membership checks can affect permission/queue reads, shared state adds command writes, and refresh can add network work. Validate against the existing paths in isolated fixtures before release. No speed exception has been granted. Use indexed instance/user membership, bounded on-demand roster reads, existing queue pagination and one active refresh owner. Avoid per-member task copies or scheduling fan-out. Stop release for measured regressions beyond noise.

Security: Owner/Admin manages additional eligible assignees. Primary changes continue through audited transfer. Shared access is exact native instance plus matching relationship; ambiguous multi-instance/client tasks remain under existing permissions. New members join the existing client Team, including its history; no client-facing chat grant. Remove only chat membership created solely by this feature, preserving independent and historical membership. Roster/action commands coordinate on the instance and work row. Retain stage/dependency/dispute gates and immutable request receipts.

Validation and release evidence: pending.

## Interim evidence and stop gate — 14 October 2026

Base: `93f08c157355b0f05d42ad468afe7cd6ee7733ab`. Isolated branch: `codex/shared-service-queue`. This is an incomplete, undeployed candidate, not a release.

Actual new migration executed in PGlite with real existing queue, review ACL, session/module ACL and chat ACL function definitions over synthetic schema/data. Five assertion groups passed: roster eligibility/authority and unchanged work; shared queue/chat; stale writes, same-request recovery, per-actor active limits and cross-member completion; prerequisite/private/cross-client denial; removal and independent chat membership; ordinary-role denial and immutable receipts. Group creation is modelled by a fixture helper, not production integration proof.

Native PostgreSQL 16.14 (fresh UNIX-socket-only cluster, synthetic data, no production calls): six independent-connection scenarios passed. Actual lock waits were observed for competing starts, one actor starting two tasks, competing completion, removal before an action and action before removal. Different members could start different tasks concurrently. Cross-member completion/replay produced one durable follow-up.

Matched alternating warmed PGlite observations (25 per arm, 1,007 work items):

| Read | Baseline median / p95 ms | Candidate median / p95 ms |
| --- | --- | --- |
| Existing single assignee | 70.94 / 72.71 | 174.43 / 177.83 |
| Primary after sharing | 71.90 / 73.84 | 208.57 / 211.69 |

This fails app_speed.md. Repeated per-item membership/instance checks, including on existing single-assignee reads, are the identified mechanism. These database-only observations do not establish production network or UI latency. Runtime implementation and release were stopped; an asynchronous user question requests selection of indexed retrieval beginning from the actor's work/service assignments. No slowdown acceptance was requested or assumed. The alternative must preserve canonical permissions, common ordering and exact work identities, then pass matched controls before release.

Outstanding: indexed retrieval decision/redesign; complete onboarding/asset and lifecycle/revocation tests; browser recovery and active refresh integration; request validation tests; full tests/build/lint and hosted checks; migration installation and exact-SHA deployment. Raw tsc reported existing test-file .ts-extension configuration diagnostics; after the two new-component type corrections no changed-runtime-path errors were reported, but this is not a completed production build.

Production read-only metadata verified the Google Ads Bruce engagement is native, active, in Onboarding. No Bruce records, service assignments, work, group memberships, history, migrations or production application were changed.

## Selected redesign and release candidate

The user selected indexed retrieval with preserved speed. The final reader builds eligible shared work once from the user's service membership, and legacy candidates from execution ownership, explicit work assignments and service defaults. It retains canonical work authorization, exact engagement/module checks, all-candidate ordering and 31-row pagination. Client/service display lookups run only for the returned page. Shared work uses common estimates/order rather than each person's calendar. No work is copied and no existing task owner, instructions, progress or sale/onboarding snapshot is rewritten by adding an assignee.

Owner/Admin opens the native service detail and chooses **Manage assignees**. The existing primary remains; additional eligible people join the same queue and existing internal client group, including its history. Primary changes still use the audited transfer dialog. Paused-service assignments can be removed. Closed services retain explicit recovery for an earlier uncertain assignment request. Pending commands are scoped to account/workspace, saved before sending and replayed with their original request ID; an account change cannot discard another account's pending receipt.

The queue refreshes through its existing authenticated GET owner on manual refresh, returning to the tab, focus or reconnect. There is no new socket or background polling. Two simultaneously visible queues may need **Refresh queue** to show a teammate's latest action; the server rejects stale actions safely. Shared claim state is reconciled under the actor lock at the next shared start if another established workflow paused/completed the item. This avoids adding a status trigger to ordinary work writes.

### Local validation

- Seven native PostgreSQL independent-connection cases: competing starts, independent workers, one actor racing two starts, competing cross-member completion and lost-response replay, removal before/after an action, and simultaneous roster edits. Actual waits are observed; one durable completion follow-up is retained.
- SQL authorization/lifecycle assertions cover admin and service eligibility, unchanged existing work, exact queue identity, independent chat grants, removal, current primary transfers, historical group access after promotion, MFA, ambiguous/cross-client/private work, module and linked-asset access, full-session denial, personal-calendar isolation, closed-service receipt recovery, ordinary-role denial and immutable receipts.
- 1,681 repository tests passed before the final release run; two request-validation tests were added. Changed-file lint, migration-history checks and production webpack compilation pass. The final exact-commit hosted gate remains mandatory.
- Chromium and WebKit component fixtures exercise on-demand loading, selection, definite/stale rejection, lost responses across reload, storage failure, corrupt recovery, account isolation and cross-member completion. The foundation runner passes 650 checks across both engines. These are synthetic component checks, not authenticated production or physical-device evidence.

### Performance evidence

The initial slow prototype was not deployed. A broader fixture also exposed small-path and command overhead. The final version reuses the locked work row for ownership checks and preserves the established scheduling UNION query plan behind an opt-in guard. The rule was not relaxed.

Matched warmed native PostgreSQL 16.14 observations, 100 per arm, alternating baseline/candidate, with synthetic data and local UNIX-socket round trips:

| Action | Baseline median / p95 ms | Candidate median / p95 ms |
| --- | --- | --- |
| Single assignee, 7 items | 4.186 / 4.358 | 3.017 / 3.367 |
| Unassigned staff, 7 items | 3.582 / 3.812 | 1.644 / 1.839 |
| Existing start | 1.423 / 1.553 | 0.970 / 1.026 |
| Existing pause | 1.077 / 1.195 | 0.895 / 0.954 |
| Single assignee, 1,007 items | 498.057 / 865.310 | 47.562 / 80.865 |
| Shared primary, 1,007 items | 481.454 / 514.382 | 21.116 / 24.263 |

The large-read run used the same final reader; the subsequent refinement affected command/scheduling writes. Small-path timing was rerun after that refinement. PGlite was also used for matched correctness/growth controls; its small-read timing had overlapping distributions (1.792 → 1.839 ms median), so the native PostgreSQL comparison above was used to investigate that apparent fixed cost. These measurements exclude HTTP, authentication, production load and device rendering. They are not production latency guarantees or a claim of sustained-session stability.

### Release and recovery

Original development base: `93f08c15`. Current production base `540543f5f2e8a426db21c9a8535c1fe686be6a3b` and its three intervening commits have been merged, including the Client Connections retirement check. No existing migration is edited.

Read-only production catalog preflight found all 11 expected baseline functions. Ten matched the fixture byte-for-byte. The work-access body differs only in indentation; its exact production definition was inspected and rehearsed locally, without replacing it with normalized text. Production PostgreSQL is 17.6; the isolated concurrency runtime is 16.14. The new tables and migration registry were absent at preflight.

Install only `20261014120000_shared_service_queue.sql`, after successful hosted checks for the exact clean candidate. The installation wrapper pins the candidate/migration digest and baseline function definitions/ACLs, uses one bounded transaction, verifies final bodies/security/settings/grants and new-table RLS before commit, and leaves the existing migration registry untouched. Independently verify the final catalog after installation, then advance main without force and verify Vercel READY, exact SHA/aliases and read-only HTTP smoke.

Application rollback must preserve these additive tables, receipts, assignments, conversations and work. Pre-feature callers deliberately reject opted-in shared actions rather than silently applying personal ownership rules; restoring the old application is therefore a safe stop for shared work, not a fully functional shared-queue rollback. Prefer a compatible forward repair. Do not erase memberships or restore old snapshots to make a rollback appear complete.

The user's Bruce Google Ads assignment remains their acceptance test. No production client assignment, work action, message, read cursor or file is created or changed for validation. Authenticated production user flows and physical Android/iPhone checks remain unverified.
