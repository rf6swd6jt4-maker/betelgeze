# Assignment dependency map

Read-only inventory taken 2026-11-14 from the full committed migration history replayed in memory
(`scripts/assignment-full-schema/replay.mjs`; 306 migrations, 531 public functions, 176 policies, 202 triggers).
It describes the schema as it is today, not historical intent. Re-generate it before relying on it after new migrations.

## Where "who is on what" is stored

| Store | Meaning | Written by | Read by (functions) |
| --- | --- | --- | --- |
| `relationships.seller_user_id`, `fulfilment_manager_user_id` | Client-level seller and manager | sale commit, POS, team save | 47 |
| `relationship_services.assignee_user_id` | Legacy per-service assignee | sale flow, `transfer_service_assignee` | 35 |
| `relationship_service_instances.assignee/seller/manager_user_id` | Current per-service-instance people | versioned instance commands | 62 |
| `service_queue_members` | Shared service roster per instance | `save_service_queue_roster` | 10 |
| `workspace_member_service_access` | Service eligibility (also scopes staff access) | `set_workspace_member_service_access`, `set_service_delivery_users`, `save_onboarding_service_with_delivery`, invitations | 27 |
| `workspace_team_members` | Team and chat membership | `sync_*`, `set_client_chat_members`, transfer | 21 |
| `work_item_assignees`, `work_items.execution_owner_id` | Task-level owner and collaborators | work item edits, transfer | 22 |
| `workspace_memberships.role` | owner / admin / staff | invitations, settings | 97 |

Also: `save_workspace_operations` (seller/manager capability), `save_workspace_maintenance_assignments`, and `defaultAssigneeId` in service definitions.
No RLS policy reads these stores directly. Access flows through database functions, so changing a store means changing those functions.

## Access functions built on assignment

| Function | Called by functions | Policies on |
| --- | --- | --- |
| `workspace_user_can_access_relationship` | 26 | relationships, work_item_relationships, asset_relationships, relationship_sms_consents, relationship_services |
| `workspace_user_can_access_work_item` | 14 | work_items, work_item_relationships, work_item_assignees, work_item_dependencies, asset_work_items, service_instance_work_items |
| `workspace_user_fully_covers_relationship` | 10 | relationship_work_items, relationship_services |
| `workspace_user_can_access_asset` | 2 | assets, asset_relationships, asset_work_items |
| `workspace_user_can_access_session_module` | 5 | relationship_onboarding_session_modules, service_instance_module_requirements |
| `client_conversation_can_access` | 17 | relationship_client_chat_members, communication_read_cursors, client_messages, communication_reactions, communication_message_deliveries |
| `workspace_user_can_sell` | 16 | none |

## Triggers on assignment tables

- `workspace_memberships`: `guard_client_team_offboarding`, `guard_service_queue_offboarding`, `sync_workspace_system_teams`, `archive_disallowed_direct_conversations`, `initialize_workspace_operations`, `seed_owner_client_connection_assignments`
- `workspace_member_service_access`: `guard_service_queue_eligibility`
- `relationships`: `guard_relationship_delivery_team`, `sync_relationship_delivery_team`, `validate_relationship_fulfilment_team`, `sync_relationship_fulfilment_chat_roster`, `queue_relationship_context`
- `relationship_services`: `guard_sold_service_assignment`, `assign_appointment_setting_setup_owners_legacy`
- `relationship_service_instances`: `guard_service_instance`, `record_service_instance_event`, `enqueue_service_sop_work`, `sync_service_fulfilment_chat`, `sync_service_queue_lifecycle`, `queue_schedule_instance`, `assign_appointment_setting_setup_owners_instance`
- `work_item_assignees`: `validate_work_item_assignee`, `clear_removed_work_item_execution_owner`, `queue_schedule_assignment`
- `workspace_team_members`: `validate_workspace_team_member`, `rotate_team_content_key`, `preserve_explicit_service_queue_chat_member`

## Application surfaces

Server actions: `app/[workspaceSlug]/users/actions.ts`, `settings/team-actions.ts`, `settings/service-actions.ts`.
Components: `ServiceCatalogue`, `ServiceTeam`, `ServiceTransferDialog`, `RelationshipServicePos`, `RelationshipServicesWorkspace`,
`RelationshipDealWorkspace`, `InlineWorkItemFields`, `PersonalWorkQueue`, `AdminWorkQueue`, `NativeAdminPanel`, `OkrWorkspace`, Settings Users.

## Behavior established by `scripts/validate-assignment-offboarding-full-schema.mjs`

Verified against the full combined schema (17 checks):

- Removing a member is refused while they are fulfilment manager or a legacy service assignee on a locked, non-archived, non-lost client, or while they are in an active shared roster (stage onboarding, setup or maintenance; instance not cancelled; client not archived).
- Removing eligibility for a service is refused only for shared-queue work in that service.
- When both guards apply, the database reports the client-team message first; fixing it then exposes the shared-queue message.
- The primary assignee of an active service instance (`relationship_service_instances.assignee_user_id`) is not guarded. Removal succeeds and the instance keeps the former member.
- Work items are not guarded. Removal succeeds and the task keeps the former member as `execution_owner_id` and as a collaborator in `work_item_assignees`.
- Rows that reference `workspace_memberships` and are deleted automatically on removal: `relationship_client_chat_members`, `service_queue_members`, `work_queue_preferences`, `workspace_member_service_access`, `workspace_operational_roles`. Everything else (relationship people, instance people, work items) references `auth.users` only and is left behind.
- `seller_user_id` is not guarded. Removing a seller succeeds and the client keeps pointing at the former member.
- A sold legacy assignee cannot be edited by a direct update ("The sold client service assignment cannot be changed"); `transfer_service_assignee` writes these rows and is the expected route.
- Locking a delivery team by direct update is refused ("Begin POS before selling this client"); locking is expected to happen through the sale/POS flow.
- Stale `fulfilment_manager_user_id` values on archived or lost clients are allowed to remain after removal.

## Test coverage gaps found

- The only existing whole-history replay (`scripts/validate-performance-full-schema.mjs`) failed at migration `20260914111000` because `pg_cron` was not stubbed, and is not run by CI. Nothing exercised the combined schema after that date until the new replay module.
- The other SQL validators build a small hand-written fixture schema and apply one or two migrations. They prove each migration against that fixture, not how the guards, access functions and triggers behave together.
- `guard_client_team_offboarding` had no database test. `guard_service_queue_offboarding` is covered only in a fixture (`validate-shared-service-queue.mjs`).

## Running the full-schema check

```bash
npm install --prefix "$TMPDIR/be-pglite" --no-save --ignore-scripts --package-lock=false @electric-sql/pglite@0.5.8
BE_PGLITE_ROOT="$TMPDIR/be-pglite" node scripts/validate-assignment-offboarding-full-schema.mjs
```

It runs in a few seconds, never reads credentials and never connects to Supabase. CI runs it in the `checks` job of `.github/workflows/foundations.yml`.
