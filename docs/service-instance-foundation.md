# SS-01 implementation and rehearsal

Implemented on 12 September 2026 and installed in production with SS-02 after a rollback rehearsal. No customer records were migrated. This is the data foundation for `service-stage-revamp-plan.md`; see `relationship-services-release.md` for current release evidence.

## Storage and authority

| Table | Purpose |
| --- | --- |
| `relationship_service_instances` | Durable instance identity, pinned catalogue revision, stage, disposition, responsibility and optimistic version. Repeated purchases may reference the same catalogue service. |
| `service_instance_stage_events` | Append-only stage/disposition/assignee history, actor, reason and request ID. |
| `service_instance_sale_items` | One frozen sale line per instance, with exact line prices, sale currency/cadence/totals and captured responsibility and its evidence source. |
| `service_instance_sessions` | Historical sale/session enrollment and a unique active enrollment per instance. |
| `service_instance_module_requirements` | Shared or service-specific session modules associated with exact instances, including review requirements. |
| `service_instance_work_cycles` | Pinned template snapshot with unique instance/phase/cycle key; no scheduler or SOP generator runs in SS-01. |
| `service_instance_work_items` | Exact links to existing work IDs and optional cycles. One shared work item may link multiple instances. |
| `service_instance_imports` | Immutable per-relationship source fingerprint and reconciliation report. |

The old `relationship_services`, relationship lifecycle, sale preparation, onboarding session uniqueness, delivery-team guards, work graph and communications authorization remain authoritative for existing app flows. No dual writes, periodic synchronization, startup reads, queue queries, subscriptions or new UI are added.

This additive boundary is deliberate: replacing the old `(relationship_id, service_key)` identity in place would break current upserts, sold-team guards, authorization and workflow keys before SS-02–06 adopt instances. New sale/instance snapshots are protected independently; the old relationship-wide sold locks remain necessary until that cutover. A prepared import is a rehearsal snapshot, not a migrated live relationship. There is no activation command in SS-01.

## Commands and constraints

Three ordered migrations implement the foundation:

1. `20260912120000_service_instance_foundation.sql`: tables, composite scope constraints, history triggers, scoped RLS and indexes.
2. `20260912121000_service_instance_import_rehearsal.sql`: bounded source snapshot, conservative classifier, dry run, explicit prepare and reconciliation.
3. `20260912122000_service_instance_foundation_commands.sql`: duplicate-safe creation and versioned changes.

`create_service_instance` accepts a published active catalogue service, a request ID, and either Negotiating or Already onboarded with Setup/Maintenance/Completed. It pins the current revision once. Retries return the same instance, including after a later operational change; reuse of the same request ID with different input is rejected. Existing-client entry makes no sale, charge, message, session or work item.

`change_service_instance` requires the expected version, request ID, actor and reason. It supports opportunity deferral/return, post-onboarding corrections, pause/cancel and eligible assignee changes. History remains intact; repeated acknowledged commands return their original resulting version. Payment/onboarding transitions are deliberately unavailable until their authoritative SS-03/04 transactions exist. Stage change alone never alters a subscription or issues a refund. Operational assignee changes do not rewrite frozen sale snapshots. For legacy imports, seller attribution comes from the sale; manager/assignee values are labelled as a legacy snapshot rather than certified historical assignments.

The original commands are service-role-only and validate owner/admin authority. SS-02 adds scoped seller management for negotiating-origin instances; they must not expose a service-role command directly to the browser or trust a client-supplied actor ID. Existing request authentication/MFA must precede server calls. Authenticated clients have scoped read access with MFA enforcement, but no direct write or command execution grants. Commercial snapshots and import reports are server-only. New work/module links also require the existing work/module read authorization. Client-chat access remains governed by its existing separate roster.

Composite keys and guards reject cross-workspace or cross-relationship links, a revision from another service, a sale line from another instance's service, a session outside its sale, a module outside its session/service and a cycle belonging to another instance. History and commercial records cannot be edited or deleted. Native instance identities and original attribution are immutable.

## Migration rehearsal

The explicit function is:

```sql
select public.prepare_service_instance_import(
    p_workspace_id := :workspace_id,
    p_relationship_id := :relationship_id,
    p_actor_user_id := :owner_or_admin_user_id,
    p_apply := false
);
```

This returns a report without writing. It includes proposed instances, stage review reasons, exact proposed work links, unattributed work/modules, unlinked sessions and unfrozen/unstructured sales that need attention. It includes no session token, provider credential or contact profile. Treat the report as private commercial data.

For isolated preparation, call with `p_apply := true` inside a `REPEATABLE READ` or `SERIALIZABLE` transaction. The entire preparation commits or fails together. Running the same source again returns the same import and IDs. If the source changes later, replay fails as stale; it never overwrites that snapshot or presents it as current. Refresh/review/activation belongs to the later cutover, which must preserve earlier evidence and new business records.

The rehearsal is bounded to one relationship with at most 500 legacy assignments, 100 sales, 500 sale lines, 100 sessions, 2,000 modules and 5,000 work links. Oversized relationships are explicitly rejected for a reviewed batch approach, not silently truncated. It is an operations/rehearsal function, not an interactive page reader.

The classifier uses these evidence rules:

- Unpurchased Lead/Nurturing/Potential Client assignments become Negotiating.
- Sold/Invoiced requires recognized payment evidence: paid becomes Onboarding; confirmed open/pending payment becomes Awaiting payment. Unknown payment status requires review.
- Onboarding/Review requires corresponding session evidence and, for linked sales, payment evidence.
- Fulfilment maps to Setup only without contradictory payment/session evidence.
- Retention, Completed/Lost and archived relationships require service-level review. Pricing alone never determines Maintenance or Completed.
- Repeated purchases become separate instances; relationship-wide stage and current assignment are not copied indiscriminately onto their history.
- Unversioned legacy services are retained with null catalogue references and explicit review reasons. They are not silently converted to the current catalogue revision.
- Work is attributed only to an exact unique matching service, without a conflicting current revision. General relationship work and ambiguous repeated-service work remain linked through the existing graph and are reported for review.

Preparation retains source sale/session/work identifiers and exact frozen commercial rows. Shared modules use the existing mandatory/service-revision module mappings. It does not clone assets, recreate appointments, change team/chat membership, reset answers or revoke links.

## Validation

Run the actual migration SQL in an isolated PostgreSQL/WASM fixture:

```sh
BE_PGLITE_ROOT=/path/to/optional-pglite-install node scripts/validate-service-instance-foundation-sql.mjs
```

The existing `scripts/pglite-fixture.mjs` documents the optional PGlite version. It is a test dependency installed outside the application, not a new runtime dependency.

Verified locally:

- All three migrations apply with SQL function-body checking enabled.
- Thirteen behavior groups exercise dry-run/prepare/replay, frozen amounts and cadence, unchanged legacy tables, stale fingerprints, repeated purchases, entry validation, optimistic versions, command replay, reopening, immutable audit, RLS identities/MFA/revocation, invalid links, shared modules/work, cycle uniqueness, missing catalogue evidence, empty relationships and batch bounds.
- RLS tests execute under PostgreSQL roles. The fixture models the legacy access helpers; it is not an audit of deployed production RLS.
- The fixture compares existing relationships, assignments, sales, sessions/tokens, module records, work/dependencies, assets, memberships and client-chat roster before/after preparation.
- A 5,000-instance growth fixture selects eight assigned instances through `service_instances_active_assignee_idx` with normal planner settings. A single observed execution was approximately 0.1 ms in PostgreSQL/WASM. This is query-plan evidence, not production or browser latency, and not a p95 result.
- The existing repository suite passed all 936 tests. Changed-file ESLint passed.

A source-checkout production build compiled but its TypeScript check encountered unrelated `output/comms-media-*/fixture.tsx` imports into another temporary checkout. An isolated copy of the current source, excluding generated `output/`, `tmp/`, nested `betelgeze/` and `.next*` artifacts, subsequently passed the complete production Webpack build and TypeScript check. Public Google Fonts access was required for this cold build. No production latency or authenticated/device UI claim follows from these checks. SS-01 changes no active user read path; the indexes are on new tables, and no backfill executes during schema installation.

## SS-02 and later handoff

SS-02 should use durable instance IDs and the new entry contract, preserve empty relationships, and add its authenticated server command layer. Do not replace old readers with imported snapshots: they remain non-authoritative and can become stale.

SS-03 must atomically bind/freeze the selected instance sale lines and establish sale-scoped seller/team responsibility. SS-04 owns active-session cutover, readiness and review evaluation, saved answers and restart/revoke. SS-05 owns work generation and cycle scheduling. SS-06 must update each dependent authorization path alongside its consuming feature, including Appointment Setting. SS-09 owns final source revalidation, review resolution and the single-writer cutover.

Before any production application, inspect deployed schema/migration state and rehearse with representative data. The schema was subsequently installed with SS-02. Rollback means retaining the additive schema and its durable instance history. Do not drop preserved history or reactivate legacy writes over a future mixed-service live state.
