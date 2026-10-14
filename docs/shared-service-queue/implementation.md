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
