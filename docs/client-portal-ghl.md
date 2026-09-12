# Client portal GHL reporting

The Results page now supports a GHL Private Integration Token belonging to one client sub-account. The user approved rollout to all relationships on 12 September 2026. Active, authorized portals can use the integration regardless of TEST metadata; workspace, session revocation and relationship archival checks remain mandatory.

## Client experience

The GHL card offers Connect GHL. Sample previews and fabricated UI metrics have been removed. Connect accepts a Location ID and a Private Integration Token. It checks the location identity and all required reads before saving. The first metrics are current contact and opportunity totals, plus open, won and lost opportunity counts across all pipelines, with no date filter. Total opportunities can also contain abandoned deals. These are CRM records, not unique acquired leads or collected revenue.

Once connected, the card shows the GHL sub-account name and last successful update. Refresh metrics performs an explicit update. Manage connection supports token/account replacement and disconnect. Failed refreshes keep the preceding successful snapshot and show an actionable error. A failed replacement retains the preceding connection. No browser storage is used for credentials. The password input is cleared after successful save or cancel.

This initial release uses manual metric refresh. Focus/visibility can reload the saved connection status after a minute; it does not contact GHL. It does not install webhooks or a scheduled synchronization worker. Google Ads remains a placeholder; the existing appointments panel keeps its current Betelgeze source.

## Provider contract

Required read scopes: `locations.readonly`, `contacts.readonly`, `opportunities.readonly`. No write scopes or agency account are required.

1. `GET /locations/{locationId}` verifies exact identity and retrieves the account name.
2. One `POST /contacts/search` requests `page: 1, pageLimit: 1` and reads `total`.
3. Four `POST /opportunities/search` requests use `page: 0, limit: 1`: all opportunities, and `status eq open/won/lost`. Related notes/tasks/calendar events/unread conversations are excluded.

The adapter uses the documented `Version: v3` header and a fixed HTTPS provider origin. Redirects are rejected. All six requests share a 20-second deadline; response bodies are bounded to 256 KiB each. This reads at most five sample records, discards them, and stores only validated totals. It never scans all CRM history or derives counts from page length. Missing/malformed totals, mismatched returned locations and ignored status filters fail the refresh. Provider error payloads and credentials are neither logged nor sent to the browser.

Verified against official documentation on 2026-09-12:

- [GHL API versioning](https://marketplace.gohighlevel.com/docs/Versioning/)
- [Location identity](https://marketplace.gohighlevel.com/docs/ghl/locations/get-location/)
- [Contact search](https://marketplace.gohighlevel.com/docs/ghl/contacts/search-contacts-advanced/), including its [linked request/response specification](https://doc.clickup.com/8631005/d/h/87cpx-158396/6e629989abe7fad)
- [Opportunity search](https://marketplace.gohighlevel.com/docs/ghl/opportunities/search-opportunities-advanced/), including its [linked filter specification](https://doc.clickup.com/8631005/d/h/87cpx-424216/7bf11bc9b94f80f)

## Storage and authorization

`20260912030000_client_portal_ghl.sql` creates a private `client_portal_secure.ghl_connections` table and a service-role-only `public.client_portal_ghl` RPC. The table is outside the public API schema, has RLS enabled, and grants no direct privileges to anon, authenticated or service_role. It holds the workspace, relationship, location identity, a Vault secret reference, a small metrics snapshot, and operation metadata. GHL tokens live in existing Supabase Vault encryption.

The HTTP route resolves the existing portal bearer session and host/workspace boundary. The RPC independently verifies session activity/revocation, relationship/workspace association, workspace activity, relationship non-archival on every operation. `20260912040000_release_client_portal_ghl.sql` removes only the earlier TEST rollout guard. Browser responses use an explicit projection, private no-store caching and no-referrer policy. Cross-site browser writes and non-JSON/oversize inputs are rejected. The client cannot choose a workspace or relationship in its request body.

Connect and refresh acquire a database lease under an advisory transaction lock. Leases expire after 60 seconds, with a one-minute minimum between attempts. Finish/fail must match the active operation ID. Disconnect clears the operation, snapshot and managed Vault secret atomically, so late responses cannot restore a disconnected token. Replacements update the managed secret only after provider validation. Cascading relationship/workspace deletion removes its managed secret too.

## Performance and verification

The GHL component remains code-split and available to all active portals. Its saved-snapshot read is independent of appointments/files and never gates the portal shell. No provider request runs on portal entry or tab switching. Both Results and Files remain mounted, retaining GHL drafts and in-flight operations. Only visible/active Results responds to focus/visibility refresh; there is no polling timer. Counts have fixed request/response bounds independent of account size. The secure table uses a relationship primary key; authorization uses existing indexed session-token and entity lookups.

Automated tests cover bounded provider queries, missing totals vs true zero, wrong account/status, sanitized errors, workspace/session isolation, TEST and ordinary relationship access, credential projection, lease-before-provider ordering, failed replacement, stale completion and request validation. `scripts/validate-client-portal-ghl-sql.mjs` executes the actual migration and concurrency/access rules in local PGlite with a synthetic Vault adapter. Run with `BE_PGLITE_ROOT=/path/to/optional/pglite-install node scripts/validate-client-portal-ghl-sql.mjs`.

The migration was applied to production through Supabase SQL Editor. A production rollback-only test passed for service-only access, TEST/workspace isolation, competing leases, actual Vault ciphertext vs plaintext, token round-trip, disconnect vs stale completion and secret cleanup. All synthetic connection data was rolled back. No Bruce token or live GHL account was used. Actual GHL data remains an integration verification step when Bruce's token is supplied.

Release checks: 909 repository tests passed after integrating the latest portal loading-screen change; changed-file lint and the production webpack build passed. Chromium checks used a production-built isolated portal with synthetic provider responses at 1280×720, 390×844, 320×568, 844×390 and 1440×390. The sample preview, form, draft persistence, navigation during a delayed connection, failed-refresh preservation, disconnect and legacy non-test layout were checked. Card content was not clipped and no horizontal document overflow was observed at narrow/short sizes. These checks establish behavior and layout, not a measured production latency improvement. WebKit and physical iOS/Android devices were not rechecked in this release. The production REST RPC returned an empty TEST snapshot after rollback and rejected anonymous execution.

## Rollback

To roll back the all-client release, restore the preceding application commit and the former TEST predicate in the RPC. Leave the new private schema dormant if connections must be preserved. Disable the RPC grant to stop its use if required. Do not drop the schema or Vault secrets as an automatic rollback; those would discard connections.

## All-relationship rollout — 12 September 2026

Removed sample-preview state, controls and sample metric values. Results / Files / Chat and the GHL connection card are now shared across all client portals. The HTTP and SQL TEST gates are removed while their existing access checks, encryption and operation leases remain intact. Portal entry still reads only a saved snapshot; no GHL call is added to navigation. The original release verification above is historical. Bruce's real connection is still user-led and has not been assumed successful.

## Calendar — 12 September 2026

Connected portals now replace the BE appointment list with a GHL month calendar. Retain the staff Appointment Setting panel. Calendar permissions are optional for CRM metrics: `calendars.readonly` and `calendars/events.readonly`, now included in the portal setup guide. The calendar shows title/time and a selected-day list only; no appointment brief, booking mutation or outcome write is implemented.

The calendar provider reads location identity/timezone and active calendar choices, then one selected calendar's six-week grid window. It makes at most three GHL requests with one 20-second deadline, 512 KiB response bounds, 100 calendars and 1,000 events maximum. Multiple calendars require a selection; no all-calendar fan-out. Events are scoped to the selected calendar, deduplicated by provider ID, stripped to title/time/status, and cancelled/deleted records excluded. Unknown/malformed dates fail instead of showing a false empty month. Dates use the location's IANA timezone and DST-aware UTC query boundaries.

`20260912050000_client_portal_ghl_calendar.sql` stores one bounded private snapshot per relationship with service-only access. It reuses portal/session/workspace authorization and serializes operations using the existing relationship lock. Credential replacement and disconnect invalidate snapshots and outstanding operations. Calendar failures retain the last successful snapshot and an explicit error. No GHL writes occur.

Calendar GET reads the snapshot only. First load, Refresh, calendar selection and uncached month navigation explicitly request provider data; ordinary portal entry and Results/Files switching never call GHL. Up to six already-loaded month/calendar snapshots stay in component memory; there is no browser persistence. Focus/visibility after one minute reads only saved state, and a changed credential revision clears resident snapshots. No polling timer or eager contact/brief lookup is added. Data loads independently of the shell, Files and Chat. The old BE component is replaced after the existing GHL status read; no extra connection-status request is added.

Live verification: after the user added calendar scopes, GHL returned seven active calendars and the dedicated PRO Construction Relaxed Comprehensive Assessment & Estimate calendar supplied one event in the September grid, using America/Chicago. This proves calendar reads; the broader GHL milestone remains incomplete at the user's request.

Rollback: revert the application calendar change and leave the private snapshot table dormant. Do not remove existing connections or their Vault secrets. The extra credential revision and invalidation trigger are backward compatible.

Calendar release checks: 919 repository tests, focused provider/handler tests, changed-file ESLint and the production webpack build passed. The actual migration passed isolated PostgreSQL tests with a synthetic Vault adapter and was then applied to production. The real encrypted connection successfully read calendar choices and a September appointment marked TESTING in GHL. Production-built Chromium checks covered 1440×1000, 390×844 and 320×568, month loading while switching Files/Results, cached return to September, retained selection and no horizontal overflow. Browser viewport checks are not physical iOS/Android or WebKit verification. No platform-wide latency claim is made; resident tab changes remain local and provider work is outside their path.
