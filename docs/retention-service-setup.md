# Retention service setup

Add Relationship → Retention collects a client manager, active published services and one eligible delivery person per service. Appointment Setting also collects meeting methods and up to four optional/required information fields. Names, dates and times remain mandatory. The server creates the relationship, allocations, configuration, internal team, lifecycle work and confirmation record atomically. A stable request ID makes a lost-response retry return the existing relationship. External confirmation delivery happens after commit.

Service eligibility enables the Appointment Setting panel; an actual allocation to the specific client's service grants appointment access. Owners/admins retain access. Removing a person from the general eligibility pool does not remove their existing client responsibility. Client-facing chat participation remains manager-controlled and separate from the internal delivery team.

## Adding a service later

The service-role-only `add_retention_relationship_service` RPC provides the backend operation for a future admin UI. It independently checks that `p_actor_user_id` is an owner/admin in the active workspace. A server endpoint must derive this actor from the authenticated session, never from a client-supplied user ID.

Parameters:

- `p_workspace_id`, `p_relationship_id`, `p_actor_user_id`: existing IDs.
- `p_service`: `{ "service_id": "…", "revision_id": "…", "assignee_user_id": "…" }`. Use the latest published revision of an active service and a currently eligible workspace member. Appointment Setting additionally requires `"appointment_configuration": { "mediums": ["phone"], "fields": [{ "key": "phone", "required": true }] }`.
- `p_reason`: nonempty audit explanation.

This operation appends an operational service at zero recorded pricing. It does not create an invoice, charge the client, restart onboarding or send a message. It adds the new assignee to the existing internal team and records a team event. Original service allocations, sales snapshots, appointments and portal sessions remain intact. Duplicate services are rejected; after an uncertain response, read the assignment before retrying.

The private transaction permit allows only this specific service insertion without unlocking the client. Ordinary writes remain protected. This is intentionally an additive operation: replacing/removing services, handing over existing staff assignments and staff suspension are outside this release.

## Database verification

Run `tests/sql/retention-service-setup.sql` after the migration, or in the same uncommitted transaction as the migration. It creates isolated fixtures and rolls everything back. It verifies atomic rejection, retry receipts, appointment configuration, internal/client chat isolation, actual authenticated RLS, preserved allocations after pool changes, and a later service addition without rewriting history. No messaging providers are called.
