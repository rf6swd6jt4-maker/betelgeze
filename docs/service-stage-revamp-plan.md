# Service stages, relationship work, and personal Work Queue

Planning baseline: 12 September 2026. SS-01's additive foundation and SS-02's relationship Services UI are implemented. SS-03–09 remain separate packages. See `service-instance-foundation.md` and `relationship-services-release.md` for evidence and adoption boundaries.

This is the detailed workstream for the Saturday relationship/service revamp and Sunday work foundation in `scaylup-betelgeze-september-11-15-checklist.md`. The newer decisions in this task supersede that checklist's earlier description of retaining a broader relationship lifecycle. Existing checklist completion claims remain unchanged.

## Outcome and boundaries

Relationships hold client identity, communication, assets, commercial history and metrics. Assigned service instances hold independent progress and delivery responsibility. A sale groups selected instances into one agreement, checkout and onboarding experience. Relationship details hold all related work. Work Queue becomes the personal Home and execution surface.

Today's target is a tested complete path through this model, including existing-client entry and the personal queue. SOP authoring/conversion, Meta Ads integration and general portal/onboarding redesign remain separate Tuesday Plan workstreams. Establishing setup/maintenance work support does not mean the Google Ads SOP has been converted.

## Proposed behavior contract

These defaults make the plan implementable but are proposals where not expressly decided by the user.

| Subject | Contract |
| --- | --- |
| Normal stages | Negotiating → Awaiting payment → Onboarding → Setup → Maintenance or Completed. |
| Unsuccessful/deferred opportunity | Negotiating can move to For later or Declined. Returning to Negotiating preserves history. Unselected POS services do not change automatically. |
| New service entry | Negotiating, or explicitly Already onboarded with Setup, Maintenance or Completed selected. No direct creation halfway through payment/onboarding. |
| Existing-client import | Records existing delivery; does not create a charge, send a message or request onboarding. Completed services generate no unfinished setup work. Maintenance entry does not regenerate historical setup work. |
| Onboarding review | Review is required work within Onboarding, rather than another public service stage. Setup unlocks after payment/exemption, required answers and applicable review. |
| Independent readiness | Shared required modules gate all linked services; service-specific modules/reviews gate their linked instances. One service can become ready before the session is entirely complete. |
| Service work configuration | Explicit Setup and Maintenance definitions, independent of upfront/retainer pricing. Retainer billing alone does not prove work is in Maintenance. |
| Recurring work | Versioned maintenance template plus cadence; materialize only the due/next cycle, with unique cycle keys and duplicate-safe recovery. The authoring/conversion UI is a later workstream. |
| Corrections and revisions | Reopen/add work within the same instance with a reason and history. Returning to Setup must not replay checkout or completed work. A new purchase creates a new instance and sale. |
| Cancellation/pause | Preserve records and provide an audited pause/cancel operation for paid work; this must not silently cancel subscriptions, issue refunds or revoke unrelated service access. Billing effects remain explicit. |
| Sale finalization | Snapshot selected instances, service revisions, pricing, currency, billing terms, seller and delivery assignments. Changes after sending require explicit supersession; never silently rewrite a live checkout. |
| Client links | Multiple sessions may coexist for disjoint service selections. Prevent duplicate active enrollment of the same instance; restart/revoke affects only the selected session and its links. |
| Reused information | Prefill compatible saved answers for confirmation; preserve each session's submitted snapshot. Never copy payment authorization or consent automatically. Never substitute another account's integration connection. |
| Responsibility | Catalogue/team eligibility determines who may deliver a service; instance assignments determine responsibility. Admin visibility is not automatic ownership. Client-chat participation remains separately controlled. |

## Source findings that shape the work

Local repository inspection, not a live database audit:

- `lib/relationship-phases.ts` and `lib/relationship-workflow.ts` implement relationship-wide phases and transitions. Workflow keys are built from relationship, phase and service key; they must distinguish instances and repeated work cycles.
- `relationship_services` originates with `(relationship_id, service_key)` as its primary key. Later sold-team guards and upserts rely on that identity. Repeated purchases require a migration across readers, writers and constraints, not just a new stage column.
- `relationship_onboarding_sessions` originates with one active session per relationship. The migration corpus must be checked against the deployed schema before replacing that constraint.
- `lib/client-sales/onboarding-checkout.ts` already resolves a session's `source_sale_id` and frozen payment definition. Extend that sale/session foundation rather than inventing a second checkout system.
- `RelationshipDealWorkspace.tsx` already reviews client information, team, onboarding and pricing. Rework its selection and mutation scope around a sale.
- `lib/admin/work-priority.ts` already includes dependencies, owners, deadlines, effort estimates, continuation, impact and manual priority. It is more than an unimplemented ranking idea; generalize and test its existing behavior.
- `RelationshipGantt.tsx` contains Current action controls. `/work/[relationshipId]` still includes a future-fulfilment placeholder; preserve actual work/detail capabilities rather than assuming that entire route is a finished editor.
- Appointment Setting code checks relationship Retention. Replace both application and database permission gates with the appropriate assigned-service capability/readiness contract.
- The current working tree contains substantial unrelated changes. Implementation commits must be scoped and tested without absorbing that work.

## Work packages and acceptance tests

### SS-01 — Data foundation and migration rehearsal

Status: implemented, rehearsed and installed with SS-02. New tables and commands coexist with the authoritative legacy flow; replacement of legacy readers/guards occurs with their consuming packages. See `service-instance-foundation.md`. SS-02 consumes this foundation.

- Give assigned services durable instance IDs, service/revision references, stage, entry origin, responsibility and stage-event history.
- Link existing sale lines to instances; retain immutable commercial snapshots and sale/session identities.
- Associate session module requirements, work items and work cycles with exact instances. Shared work can explicitly link several instances without being duplicated.
- Replace relationship-wide sold immutability with sale/instance-level protections. Preserve historical seller attribution and existing internal/client group boundaries.
- Add indexes for workspace/user active work, relationship instances, sale/session lookup and dependency readiness. Define foreign keys and authorization before UI writes.
- Prepare an idempotent migration dry run. Map old stages only when evidence supports them: prospects → Negotiating; sold/invoiced → payment state verified from sale; onboarding/review → Onboarding; fulfilment → Setup; retention → inspect per-service evidence. Do not automatically declare every upfront service Completed or every service Maintenance.
- Keep ambiguous records on the legacy path until reviewed. Preserve invoices, submitted answers, assets, appointments, tokens, assignments and completed work IDs.

**Done:** fixture migration can be replayed; two instances of the same catalogue service coexist; historical totals/links match; ambiguous records are reported rather than guessed; existing users retain their authorized access.

### SS-02 — Simplified creation and relationship Services UI

Status: implemented and validated; see `relationship-services-release.md`.

- New relationship asks for contact/person identity, optional business/contact details, with optional metadata kept secondary. It has no service, payment, onboarding or lifecycle wizard.
- Detail page keeps information at the top, the existing Gantt below, and the relationship work queue directly beneath it. The Gantt left column doubles as the expandable services list; each service has its own lifecycle. Sale/onboarding history is a secondary disclosure. No relationship section tabs.
- Add service chooses a published catalogue service, entry mode and applicable assignee. Existing-client entry can select Setup, Maintenance or Completed.
- Each instance shows service name, stage, assignee and relevant progress. Add service-stage filters to the relationship list; do not invent a single aggregate relationship stage.
- Update relationship context, search labels, filters and value summaries. Count negotiated potential separately from committed sales and recurring value; do not double count repeat instances or deferred opportunities.

**Done:** verify the continuous information/chart/queue layout on phones and desktop; expand independent service lifecycles from the chart; create an empty relationship; assign three services; import Andy's website as Completed and Ads as Setup; refresh and retain exactly that state without sending or charging anything.

### SS-03 — POS sells a selected set

- POS lists Negotiating instances with explicit multi-selection. Keep client review, team allocation, onboarding preview and pricing review.
- Compose preview and prices only from selected instances. Reuse existing supported billing/currency rules and reject unsupported combinations clearly.
- Finalize one sale atomically, reserve its selected instances and create/reuse its session/link through existing durable delivery mechanisms.
- Move only selected instances to Awaiting payment. Leave unselected instances unchanged and provide explicit For later/Declined actions.
- Prevent double sale from concurrent tabs, repeated clicks or a lost acknowledgement. Retrying link delivery must not recreate the sale.

**Done:** select Meta Ads and landing page from three Negotiating services; checkout and modules contain only those two; Appointment Setting remains unchanged; retry creates no duplicate sale/session/charge.

### SS-04 — Multiple onboarding sessions and service readiness

- Scope session composition, autosave, uploads, submission, checkout, payment return, webhook processing, review work, restart and revoke to the sale/session and selected instances.
- Deduplicate shared module requirements within a session using canonical module identity/revision; preserve ordered published snapshots.
- Add compatible answer prefill with confirmation and clear ownership of shared fields. Concurrent sessions retain independent submissions; promotion to the relationship's current information must not silently overwrite newer values.
- Calculate readiness per instance. Shared answers and reviews can satisfy several services; service-only missing answers do not block unrelated setup.
- Update Onboarding panel to show sessions as records, labelled by relationship and selected services. Open by session ID; preserve old relationship URLs through an explicit session chooser or unambiguous redirect.
- Keep portal identity and existing provider links stable across new sessions. A new sale must not rotate the relationship portal or disconnect an existing integration.

**Done:** two active sessions on one relationship work independently; payment/submission/restart of one leaves the other intact; shared questions appear once; service-specific readiness works; both sessions and submissions remain visible in Onboarding.

### SS-05 — Instance work engine and relationship Work view

- Adapt existing work items, dependencies, updates, assets and completion requirements to instance scope. Replace relationship-wide transition handlers with explicit service/sale/session actions.
- Generate Setup work once from the pinned template revision. Preserve existing generated work and manual edits. Keep manual task creation usable when an SOP is not yet configured.
- Setup completion moves the instance to Maintenance only when configured; otherwise Completed. Maintenance cycle completion schedules its next eligible cycle, not completion of the whole service.
- Relationship Work supports all services or a selected instance, a shared List and Gantt planning view. Shared relationship work remains possible.
- Keep one authoritative completion command for queue and work-item detail, including dependency, assignment, review and stale-state validation.

**Done:** complete Ads setup without changing website or another service; reopen a task without replaying payment; retries generate neither duplicate setup tasks nor duplicate maintenance cycles; Gantt and detail reflect the same work.

### SS-06 — Permissions, teams and operational consumers

- Update RLS/RPC checks and app guards together for service instances, sale scope, sessions, work and archives.
- Replace Retention/lifecycle-based Appointment Setting and other panel gates with explicit eligible instance states and capability/assignment checks.
- Define reassignment and team reconciliation without giving internal staff automatic client-chat access. Preserve previous commercial attribution.
- Ensure archive/cancel prevents new actionable work while keeping historical records and unrelated active services accessible.

**Done:** seller, manager, service-assigned staff, admin and unassigned staff fixtures all have correct visibility/actions; cross-workspace access fails; a second service purchase does not break the first service's team or Appointment Setting.

### SS-07 — Personal Work Queue and Home

- New panel defaults to My work for every user, including users with no assignments. Provide an honest empty state.
- Show recommended current work with its relationship/service, reason, relevant deadline and appropriate action. Sales opens scoped POS; reviews open relevant submissions; manual tasks use guarded completion. Waiting for payment/client input cannot be manually completed.
- Below it, show ordered actionable work and separate Waiting/Blocked/Scheduled views. Keep personal responsibility distinct from optional authorized oversight/unassigned work.
- Adapt the current Admin engine: authorization and assignment first; dependency readiness next; then deadline/urgent obligations, continuation where safe, impact/enabling work, and deterministic backlog ordering. Preserve existing manual overrides, duration estimates and explanation labels.
- Relationship work without OKR data must remain schedulable through deadlines/priority, without invented revenue or impact scores. Freeze fixture examples before changing ranking semantics.
- Rank against the correct authorized candidate set and dependency summaries before paginating display. Do not rank only an arbitrary first page or load the full workspace graph into the browser.
- Refresh on relevant mutations/access changes using existing native GET/cache owners; keep a started item stable while showing priority updates. No continuous full-graph polling on Home.

**Done:** two staff see different queues; an admin sees only their own assigned execution work in My work; a blocked urgent task is never suggested as executable; completion advances only eligible successors; access revocation removes protected work.

### SS-08 — Navigation cutover and obsolete UI removal

- Make Work Queue the default Home for new navigation while preserving resident tabs, drafts and restored valid routes.
- Remove Fulfillment panel entry after relationship Work is complete. Redirect old detail URLs to relationship Work and old collection URLs to the appropriate new surface.
- Remove Admin's duplicated queue UI, retaining Admin-specific OKRs, maintenance and management capabilities.
- Remove Gantt Current action bar only after queue equivalents work. Preserve the planning chart and work-item detail access.
- Update panel registry, native renderers/cache keys, search, shortcuts, context, labels and `docs/ui-standards.md` together. Retire relationship-stage display without losing archived/test classifications.

**Done:** old bookmarks lead somewhere useful; no broken panel permissions or blank restored tabs; personal Home loads without eager Gantt or Admin data; no duplicate Current execution surface remains.

### SS-09 — Release verification and rollout

- Run focused behavior and authorization tests, changed-file lint, complete test suite, diff checks and production build.
- Test combined sale, two concurrent sessions, repeat purchase, imported existing work, assignment changes, archive, lost acknowledgements and provider webhook replay using isolated fixtures with external delivery disabled.
- Verify desktop Chromium/WebKit and Android/iPhone-sized layouts. Record physical-device checks separately.
- Measure matched cold/warm relationship entry, POS opening, queue readiness and completion using the existing performance contract. Inspect query plans and candidate/dependency growth before queue rollout.
- Migrate first in rehearsal, then enable a controlled pilot after release authorization. Keep unmigrated relationships usable; do not allow two engines to mutate a migrated relationship.
- Rollback must preserve new instances and sales. Old code cannot safely resume writes against newly mixed service states; retain compatible readers or pause the new writes while repairing. Dropping the new tables is not rollback.

**Done:** evidence recorded per scenario, migration reconciliation clean, no unresolved material performance regression, and deployment plus authenticated verification reported separately.

## Execution order and Tuesday Plan checkpoints

1. Lock the behavior contract and acceptance fixtures; SS-01 is the first implementation gate.
2. SS-02 and SS-03 deliver creation/service selection/POS on that foundation.
3. SS-04 and SS-05 deliver the complete purchase-to-service-work path. SS-06 is required alongside every mutation, not postponed security work.
4. SS-07 adds the personal execution surface; SS-08 removes the replaced surfaces.
5. SS-09 gates release and completion.

| Checkpoint | Tuesday Plan placement | Completion boundary |
| --- | --- | --- |
| A: Foundation | Saturday first | SS-01 plus agreed transition/migration fixtures. |
| B: Sell and onboard independent services | Saturday core target | SS-02–04 and applicable SS-06 checks; mixed-service sale and second session pass. |
| C: Deliver and execute personal work | Saturday ambitious target; Sunday buffer | SS-05–08; Andy import and two-user queues pass. |
| D: Release evidence | Before declaring revamp done | SS-09 including migration and authenticated checks. |
| E: SOP and manager readiness | Sunday after foundation | Convert the chosen Google Ads/Meta Ads SOP, assign the intended manager and verify their real workflow. |
| F: Onboarding/portal polish | Monday | Continue existing Tuesday Plan work on the new sale/session model. |
| G: Andy readiness | Tuesday | Verify intended services, staff access, Comms and client portal without duplicate purchases or onboarding. |

There is no measured basis for promising all packages will ship today. If time runs short, finish and verify the current checkpoint, retain the existing operational entry points, and use Sunday's planned foundation buffer. Do not remove Fulfillment or publish a partially connected service/payment model to meet the calendar.

## Items to settle before their work package

- SS-01: approve public stage names, For later versus Declined, and audited pause/reopen behavior.
- SS-04: approve per-service readiness within a shared session and review ownership; decide which existing answer types may prefill.
- SS-05: choose the first maintenance cadence and template fixture; real SOP conversion remains separately tracked.
- SS-07: review concrete queue ordering examples against current Admin behavior, including deadlines versus in-progress work and manual overrides.

These are product decisions, not permission requests to perform the planning audit. This document does not authorize a production release or external client messages.
