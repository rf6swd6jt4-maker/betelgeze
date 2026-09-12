# SS-02 relationship services

Implemented 12 September 2026 on an isolated checkout of production main. SS-01's additive schema is a prerequisite. SS-03 selected-service POS is the next package.

## Behavior

- Creation asks for name, optional company/email/phone and secondary Test metadata. It creates no sale, onboarding, work or outbound message. Database receipts recover a retry without another relationship.
- Relationship details share Services, Work, Sales & onboarding, contact editing and the archive controls in both server and native rendering. Existing timelines and commercial history remain available through the previous POS route.
- Service assignment pins the selected published revision. New opportunities start Negotiating; owners/admins can record existing delivery in Setup, Maintenance or Completed. Repeated purchases have separate identities. Eligible assignees are checked in the database. Reasons, versions and request receipts guard stage/assignment edits.
- Relationship list filters match any assigned service stage. Context and search open the relationship as the client record. Potential values exclude For later/Declined and remain separate from frozen committed sales; currencies and billing cadences are not combined.
- Legacy assignments remain read-only in the new view and retain their current workflow. Ambiguous historical progress displays Review needed. No automatic import or workflow cutover occurs. A relationship with new instances cannot sell those services through the old relationship-wide POS.
- The `services-v1` native read contract coexists with the previous contract so already-open browser tabs can finish safely during a rolling release.

## Performance contract

Default detail entry no longer loads the full onboarding configuration, signed module media, POS team configuration or Gantt graph. Services are bounded to 30 rows; list summaries carry at most four service names. Catalogue/search, eligible people, work and history load only when requested. The existing account-scoped native cache owns refresh after mutation; detail autosave retains the established draft journal, conflict checks and replay commands.

These are query/payload and browser-fixture observations, not measured production latency claims. Existing list/bootstrap scope is retained. The database migration does not run an import or generate work when installed.

## Verification

- `BE_PGLITE_ROOT=/private/tmp/be-delivery-dbcheck node scripts/validate-service-instance-foundation-sql.mjs`: 13 PostgreSQL behavior groups, including RLS/MFA, replay, immutable history and 5,000-instance index use.
- `BE_PGLITE_ROOT=/private/tmp/be-delivery-dbcheck node scripts/validate-relationship-services-sql.mjs`: eight PostgreSQL groups covering creation, revision pinning, independent entry/stages, assignment/visibility, stale writes, potential values and bounded reads.
- The exact combined SQL package was parsed/executed locally and rehearsed against the production schema inside a transaction ending in rollback. Production rehearsal also created an isolated test relationship and three service instances, verified replay and absence of a sale/session, then rolled back all changes.
- Chromium and WebKit fixture checks at 320, 390, 639, 640 and 1280 pixels passed: service row actions, stage choices, creation/keyboard dismissal, catalogue, existing-client entry, eligible-person selector, no horizontal overflow or browser exceptions. Desktop and phone screenshots were inspected. These are browser emulation, not authenticated or physical-device QA.
- Repository tests: 947 passed. Changed-file ESLint and the complete production Webpack/TypeScript build passed.
- Temporary previews and SQL transport documents were removed before the release build.

## Deployment boundary

The four additive migrations were applied to production after the rollback rehearsal. Post-install counts remain 42 relationships and 34 legacy assignments, with no new instances or creation receipts. The release package SHA-256 is `595e8ba6302e6d5f7043c533b9a3228d5c07209381ec8aea466fff1fd3f79ba7`. Application deployment is pending the scoped commit. Keep the new tables and compatible readers if the UI needs repair; do not drop instance/sale history as rollback. Full selected-service sales, multiple-session runtime and service work generation remain SS-03/04/05 respectively.
