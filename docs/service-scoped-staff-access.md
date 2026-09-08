# Workspace authority and client delivery responsibility

Owner, Admin, and Staff govern workspace administration. Selling, managing clients, and fulfilling services are separate, overlapping responsibilities. An owner may do all three; a Staff user may sell, manage, fulfil, or combine those positions.

## Configuration

- Settings > Teams enables selling and management positions and their panel permissions. It also controls service fulfilment permissions and owner-managed maintenance routing.
- Settings > Services chooses the eligible fulfilment people for each service. Every current member can be eligible, including Owner and Admin. A service can have several candidates or none while being configured.
- Invitations do not require a service. Joined members can use team chat; direct messages retain their existing Owner/Admin restriction.
- Service capabilities combine with operational capabilities. Owner and Admin retain administrative panel access. Operational permission changes do not replace workspace roles.
- Appointment Setting still requires an installed, non-archived Appointment Setting template service and, for Staff, the service capability.

## POS and client teams

Starting POS records the authenticated initiating seller under a relationship row lock. Resuming POS preserves that seller, and another user cannot take it over. POS reviews relationship details, selects a manager and one eligible fulfilment person for each purchased service, reviews onboarding, and reviews prices.

Sale validation requires the seller to be a current member, the manager to be eligible, and each service to have an eligible fulfilment person. Freezing the sale or moving it to Sold locks its team and creates one internal conversation named `Team: [relationship name]`. Membership is the deduplicated union of seller, manager, and service fulfilment people. Retries reuse the group. Seller attribution is also recorded on the sale.

Client teams and service allocations cannot be changed after sale. Changes to future service eligibility preserve existing allocations. Removing a member responsible for an active client is rejected until a handover can be performed. The client-team handover UI is intentionally outside this release.

Service eligibility makes someone a possible choice. It does not grant responsibility for every client buying that service. Staff record access follows actual client assignments. Onboarding service modules use the particular client's service allocation; mandatory modules are shared with its assigned staff. Existing manager/seller responsibilities continue to contribute configured permissions if future eligibility is disabled.

## Communications

The internal delivery conversation contains the seller, manager, and selected fulfilment staff. Its roster is read-only. Admins and Maintenance remain workspace groups; existing custom group history is retained and read-only. They are not delivery teams.

The client conversation contains the client, seller, and manager by default. The manager can include or remove fulfilment people already assigned to that client. Inclusion grants conversation history and sending access; it does not change delivery responsibility. An administrator who is not a participant does not receive blanket client-chat access.

API reads/writes, decrypted message RPCs, attachment-key access, database policies, bootstrap lists, and push recipients use conversation participation. Membership is checked independently of visible navigation. Team-message realtime continues to use conversation membership; the workspace realtime channel carries invalidation/presence signals.

## Migration and verification

Apply `20260909100000_client_delivery_teams.sql` before deploying its application revision. The transaction imports existing sold clients from their saved seller, manager, and service allocations. Missing historical assignments are preserved rather than guessed. Existing owner/admin users and already recorded sellers/managers are enabled for those positions; admins should review the initial eligible pools.

`tests/sql/client-delivery-teams.sql` creates a disposable workspace inside a rollback transaction and checks empty-workspace setup, overlapping roles, eligibility, POS ownership, sold-team guards, client-chat access, manager inclusion/removal, offboarding, and duplicate company names. Local PostgreSQL fixtures cover the new responsibilities; production rollback checks must additionally validate compatibility with the complete schema, encryption triggers, and existing data.

This release supplies client/service allocations for future fulfilment and retention work. It does not introduce a new fulfilment engine, seller/manager group creation UI, or client-team reassignment UI.
