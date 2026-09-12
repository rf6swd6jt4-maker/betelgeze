# SS-02 relationship services

Implemented 12 September 2026 on an isolated checkout of production main. SS-01's additive schema is a prerequisite. SS-03 selected-service POS is the next package.

## Behavior

- Creation asks for name, optional company/email/phone and secondary Test metadata. It creates no sale, onboarding, work or outbound message. Database receipts recover a retry without another relationship.
- Relationship details use one continuous layout in both server and native rendering: contact information, service Gantt, relationship work queue, history disclosure and archive controls. The left side of the existing Gantt is the expandable services list; editable service names open service settings. The prior three-section tab layout has been removed.
- Service assignment pins the selected published revision. New opportunities start Negotiating; owners/admins can record existing delivery in Setup, Maintenance or Completed. Repeated purchases have separate identities. Eligible assignees are checked in the database. Reasons, versions and request receipts guard stage/assignment edits.
- Relationship list filters match any assigned service stage. Context and search open the relationship as the client record. Potential values exclude For later/Declined and remain separate from frozen committed sales; currencies and billing cadences are not combined.
- Legacy assignments remain read-only in the new view and retain their current workflow. Ambiguous historical progress displays Review needed. No automatic import or workflow cutover occurs. A relationship with new instances cannot sell those services through the old relationship-wide POS.
- Each service has a separate lifecycle. Legacy assignments repeat existing recorded lifecycle dates; native instances use their own audit events. Real work remains linked once, including shared work. Virtual summary rows never become writable work IDs or invented historical dates.
- The relationship queue orders available work before scheduled, waiting and blocked work, excludes completed work, and checks predecessor status. Work opens through its existing detail/POS flow. This is the relationship queue; the personal panel and unified execution commands remain SS-07.
- The `services-v1` native read contract coexists with the previous contract so already-open browser tabs can finish safely during a rolling release.

## Performance contract

Default detail entry no longer loads the full onboarding configuration, signed module media, POS team configuration or Gantt graph. Services are bounded to 30 rows; list summaries carry at most four service names. The chart code and graph load as their section approaches the viewport; the queue has its own visible-section read. Both pause reads in inactive workspace tabs. The chart caps real work at 500 items and signals truncation; the queue pages 30 open records at a time. Catalogue/search, eligible people and history load only when requested. The existing account-scoped native cache owns refresh after mutation; detail autosave retains the established draft journal, conflict checks and replay commands.

These are query/payload and browser-fixture observations, not measured production latency claims. Existing list/bootstrap scope is retained. The database migration does not run an import or generate work when installed.

## Verification

- `BE_PGLITE_ROOT=/private/tmp/be-delivery-dbcheck node scripts/validate-service-instance-foundation-sql.mjs`: 13 PostgreSQL behavior groups, including RLS/MFA, replay, immutable history and 5,000-instance index use.
- `BE_PGLITE_ROOT=/private/tmp/be-delivery-dbcheck node scripts/validate-relationship-services-sql.mjs`: 11 PostgreSQL groups covering creation, revision pinning, independent entry/stages, assignment/visibility, stale writes, potential values bounded reads, separate timeline audits, dependency-aware queue ordering, and graph/queue limits with 1,200 additional work items.
- The exact combined SQL package was parsed/executed locally and rehearsed against the production schema inside a transaction ending in rollback. Production rehearsal also created an isolated test relationship and three service instances, verified replay and absence of a sale/session, then rolled back all changes.
- Chromium and WebKit fixture checks at 320, 390, 639, 640 and 1280 pixels passed: service row actions, stage choices, creation/keyboard dismissal, catalogue, existing-client entry, eligible-person selector, no horizontal overflow or browser exceptions. Desktop and phone screenshots were inspected. These are browser emulation, not authenticated or physical-device QA.
- The revised chart/queue fixture passed all ten Chromium/WebKit viewport combinations: independent expansion, preserved real work links, service editing from the chart, zoom, continuous page order, no tabs, document overflow or browser exceptions.
- Five pure projection tests cover repeated services, legacy dates, single-service hierarchy, shared work and instance isolation.
- Repository tests: 952 passed. Changed-file ESLint and the complete production Webpack/TypeScript build passed.
- Temporary previews and SQL transport documents were removed before the release build.

## Deployment boundary

The four additive migrations were applied to production after the rollback rehearsal. At the initial installation check, counts were 42 relationships and 34 legacy assignments, with no new instances or creation receipts. The release package SHA-256 is `595e8ba6302e6d5f7043c533b9a3228d5c07209381ec8aea466fff1fd3f79ba7`. Initial SS-01/02 application deployment succeeded at `a7a78ca3`. The continuous-layout revision adds only two authorized read functions in `20260912150000_relationship_service_timeline.sql`; it was rehearsed with read checks across eight production relationships, rolled back, then installed successfully. The final production build, lint and 952 tests passed after removing all temporary fixtures. Application deployment is verified separately from authenticated or physical-device QA. Keep the new tables and compatible readers if the UI needs repair; do not drop instance/sale history as rollback. Full selected-service sales, multiple-session runtime and service work generation remain SS-03/04/05 respectively.
