# Workspace performance implementation status

September 10, 2026. Branch: `codex/workspace-performance-revamp`, based on `e781507a`. This is a staged implementation of the [revamp plan](workspace-performance-revamp-plan.md), not completion of every phase. No production migration, service purchase, flag enablement, merge or deployment was performed while preparing this PR.

## Included

- A native panel host inside the existing workspace shell, with independent tab URLs, filters and history; existing frame routes remain available. Relationships, Library assets/work items, Fulfilment Work, Appointment Setting and Admin have authenticated JSON loaders and native views. The route inventory gives the exact coverage.
- An account/workspace-scoped, bounded memory cache with shared reads, request coalescing, freshness checks, invalidation, late-response fencing and account clearing. Auth/session changes clear protected snapshots and present recovery. Intent prefetch is bounded; native links do not also prefetch Next.js page responses.
- Durable appointment and relationship background edits, ordered per record, with stable request IDs, optimistic versions, atomic command receipts and conflict recovery. Navigation can proceed when a draft is safely stored; storage failure cannot silently discard an unconfirmed edit. Newer typing survives an older acknowledgement. Draft workers outlive the originating editor, and account changes stop its work.
- A JSON appointment submission path and a gated transactional notification outbox. Appointment acceptance and external notification delivery have distinct states. Worker leases recover pre-dispatch failures; uncertain external sends are preserved for reconciliation instead of blindly retried.
- Communications initially loads the selected mode, then defers other modes. Historical pages use stable timestamp/ID cursors, decrypt bounded candidate pages, and scope delivery metadata reads. Image ingestion prepares previews; prepared preview reads avoid redundant object inspection and transformation work.
- Content-free interaction measurements, route/action inventory, browser benchmark and summary scripts, recovery tests, migration tests, and rollout instructions.

Existing UI primitives, authorisation guards and business transitions are retained. Native and legacy views temporarily coexist; changes to their common data or presentation must cover both until the legacy extraction is removed.

## Enablement and rollback

All new architectural paths are off by default. Use workspace UUID allowlists, not `all`, for the first staged exercise:

| Setting | Effect |
| --- | --- |
| `WORKSPACE_NATIVE_PANELS` | Enables registered native panels and appointment command clients for the selected workspace UUIDs |
| `WORKSPACE_RELATIONSHIP_DRAFT_COMMANDS` | Independently enables durable relationship background commands for selected workspace UUIDs |
| `WORKSPACE_APPOINTMENT_OUTBOX_READY=1` | Enables queued appointment notifications only when the workspace native flag also applies; requires a configured, verified worker schedule |

The [command operations guide](workspace-performance-command-operations.md) specifies migrations, scheduler authentication, drain/recovery and rollback. Turning off the UI must leave accepted commands/jobs recoverable. Keep their endpoints, receipts and worker available while queues drain; do not drop the new schema as a quick rollback.

Communications query/media improvements are not controlled by the native flag. History reads retain a compatibility path when their new RPC has not been installed. Review these changes independently when deploying the branch.

## Validation and its limits

The full `npm test` suite passes **810 tests**. The production webpack build, including TypeScript and static generation, passes. Focused changed-code lint and source TypeScript checks pass. Tests exercise request deduplication, stale responses, account clearing, storage failure, lost acknowledgements, concurrent versions, navigation checkpointing and queue recovery. Four SQL suites exercise the actual new command/outbox/history migrations in an isolated PostgreSQL-compatible engine with explicitly simplified existing permission/encryption fixtures. The portable runners and optional dependency setup are in the operations guide. They are not a substitute for applying the migrations to the full Supabase schema.

An isolated fixture rendered the real shell/native components with synthetic, intercepted JSON responses. In Chrome and WebKit at a 390 × 844 viewport, Relationships filtering reused its loaded snapshot; Relationships → Work Items → Assets → workspace back → browser back completed with three panel reads and no child frame. Chrome had no browser errors; WebKit emitted the existing unsupported `interactive-widget` viewport warning. Additional Chrome checks verified a late save restarts an interrupted cold read and renders the destination, a 409 session response shows an uncovered recovery action, same-user account preservation retains content, and account clearing prevents private data from refilling even on focus. The expected 409 browser resource warning is not an application exception. This is functional evidence, not an authenticated latency benchmark. Development compilation, mock data and the local machine do not establish a production p95. The temporary route and development proxy exception were removed before committing.

Release gates remain: full-schema staged migration and permission checks, authenticated desktop and mobile comparisons, concurrent browser windows, account/MFA changes, provider delivery and crash recovery, physical iPhone/PWA checks, and controlled end-to-end timings on representative data and networks. The old audit measurements are preserved in [the baseline report](performance-baseline/assessment.md); they must not be compared directly with mock-browser timings as a measured speedup.

## Remaining plan work

- PowerSync feasibility and provider configuration have not been completed. No PowerSync SDK, replication rules or subscription is installed. The current adapter is HTTP plus memory caching; record snapshots do not survive a cold browser restart. Durable edits are separate from read persistence.
- Onboarding, Settings and Lead Gen still use existing frame routes. Builder, token-based portal and account flows retain their established boundaries. Native read extraction does not mean that every mutation in a migrated module has become an independent JSON command: appointment create/delete and several work/relationship business actions remain Server Actions.
- Communications still uses broad initial history windows to preserve summary, search and unread semantics. Exact conversation summaries plus selected-conversation-only bootstrap remain necessary before claiming the complete startup redesign.
- Mutation invalidation is conservative across native snapshots. Narrow record-level reconciliation, full cross-session subscriptions, persistent record restoration, complete server span correlation, and production query plans/compute-region decisions remain work.
- No near-instant navigation, sub-second server acknowledgement or repeat-launch target has been certified. Measure those against the real release candidate before widening rollout.

This PR makes the initial structural changes reviewable and reversible. It must not be reported as the finished platform-wide revamp or as a production performance result.
