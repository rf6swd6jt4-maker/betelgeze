# Platform foundation

This is an ownership map, not a declaration that every production workflow is verified. Read `app_speed.md`, `app-alerts.md`, and `docs/ui-standards.md`; they remain authoritative. Current release evidence lives under `docs/consolidation/2026-09-23/`. Known evidence gaps must stay visible rather than becoming assumed guarantees.

| Boundary | Existing owner | Preserve when adding features |
| --- | --- | --- |
| Resident workspace | `WorkspaceTopBarClient`, `workspace-tabs`, frame bridge/guard, `NativeWorkspaceTab` | One navigation owner; independent retry; exact destination/paint identity; no incidental reloads/remounts |
| Read snapshots | `WorkspaceRecordCache` and authorized native GET endpoints | Account/workspace scope, deduplication, deadlines, cancellation, access-loss clearing, bounded inactive entries |
| Draft departure | `workspace-mutations`, `workspace-tab-departure`, `workspace-departure-final-check`, `workspace-draft-journal` | Final checkpoint before owner disposal; failed checkpoint retains owner; explicit recovery; no automatic replay |
| Mobile viewport | Workspace shell mobile resident viewport; legacy iframe and standalone portal controllers separately | One owner per surface, stable chrome, native selection/scroll, no user-agent forks; physical Android and iPhone evidence separate |
| Reading and alerts | `app-alerts.md` implementation map | Exact visibility and acknowledgement semantics; no inferred reads or silent changes to delivery/recovery |
| Records and attachments | Authorized record commands, attachment endpoints, immutable versions and receipt RPCs | Retry idempotency, concurrency, field/relationship scope, committed-versus-refreshed distinction |
| Onboarding and sales | Immutable service/module revisions and snapshots, canonical runtime and durable outbox | Sold identity/history, access isolation, accepted work, provider completion distinct from queue acceptance |
| Shared UI | `components/ui`, `components/panel`, `components/list`, `components/detail` | Reuse documented primitives; change existing uses with a primitive change |
| Retired Lead Gen | Bounded admin archive and API tombstones | Historical rows, provenance and storage remain; no operational runner/importer revival |

Each implementation identifies the affected owner, current callers, interaction invariants, data effects and relevant regression pack before editing. Add features through that owner's narrow interface. A feature must not introduce a parallel cache, viewport, navigation, mutation or subscription owner merely because importing a second helper is easier.

Keep fixes demonstrable: record a failing baseline and passing candidate where practical. Fixture checks, full application checks, production telemetry, provider delivery and physical devices establish different facts. New scope is not a reason to weaken an existing check.
