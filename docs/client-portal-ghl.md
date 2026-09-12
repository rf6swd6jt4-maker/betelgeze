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

## Owner calendar — 12 September 2026

Connected portals replace the BE appointment list with the GHL owner's month calendar. The staff Appointment Setting panel remains available. Calendar permissions are optional for CRM metrics: `calendars/events.readonly` and `users.readonly`, included in the portal setup guide. `locations.readonly` is already required by the connection. No agency subscription or booking-calendar picker is introduced. Appointment briefs and booking/outcome writes remain deferred.

The source is a GHL user schedule, across booking calendars. On initial resolution, read location identity/company/timezone and the location-scoped users search. Only one explicitly designated `isAgencyOwner` with access to that location qualifies. Do not infer an owner from name, email, admin role or response order. Missing, ambiguous or incomplete owner results produce a setup issue instead of selecting somebody else. Existing owner bindings are checked on every refresh; a revoked binding fails and is rediscovered on the next explicit refresh.

Read `/calendars/events` and `/calendars/blocked-slots` with `userId` and the location's DST-aware six-week date window. Keep cancelled appointments visible with struck-through titles. Discard private blocked-event titles immediately and expose only Busy. Multi-day blocks appear on each covered day, with midnight end dates exclusive. Return only validated IDs, kind, title, time, status and all-day flags. The browser cannot supply user/calendar overrides and never receives company identifiers or credentials.

First owner resolution uses four bounded GHL requests. Subsequent refreshes use three parallel requests: owner verification, appointments and blocks. All share a 20-second deadline, 512 KiB response bounds and a combined maximum of 1,000 events. Cross-user/location rows or malformed dates fail instead of producing a misleading empty month. No provider writes occur.

`20260912050000_client_portal_ghl_calendar.sql` supplies the private snapshot table and leases; `20260912060000_client_portal_ghl_owner_calendar.sql` changes its contract and discards replaceable legacy booking-calendar snapshots. Connections and Vault secrets are preserved. Portal/session/workspace checks, competing operation leases and credential-revision invalidation remain intact. Owner binding metadata stays private. Calendar failures preserve the last successful snapshot and a visible error; superseded booking-calendar snapshots are never presented as owner schedules.

Calendar GET only reads saved state. Explicit Load/Refresh and uncached month navigation request provider data. Portal entry, resident Results/Files switching and focus/visibility checks do not call GHL. Up to six month snapshots remain in component memory, scoped by connection revision and owner. No browser persistence, polling timer or appointment-detail lookup is added. The shell, Files and Chat remain independent.

Live provider verification identified PRO Construction through GHL's explicit owner designation. Its September grid contains two appointments (including one cancelled) and ten Busy blocks, using America/Chicago. This supersedes the earlier incorrect booking-calendar selection. The broader GHL milestone remains incomplete at the user's request.

Checks: all 924 repository tests, focused provider/handler tests, changed-file ESLint and production webpack build passed. The actual migration passed isolated PostgreSQL tests with a synthetic Vault adapter. Production-built Chromium and WebKit checks at 1440×1000, 390×844 and 320×568 passed: Busy rows, cancelled status, no calendar dropdown, no horizontal document overflow, retained Results/Files state with no additional requests and local return to a cached month. These used a sanitized live-provider snapshot in a local browser fixture. No physical iOS/Android verification or platform-wide latency improvement is claimed.

Rollback must restore both application and prior RPC contract together. Leave connections and Vault secrets intact; cached calendar snapshots are replaceable.

## Descriptive portal titles — 12 September 2026

Portal titles use the appointment's exact `contactId`, supplied by GHL, to display the linked contact's name and city. For example: `Manuel Rodriguez · Fort Worth`. The original GHL title stays in the selected-day list, alongside an explicit **Contact location** label. The city is a contact-record fact, not a confirmed appointment/job address. No GHL or Google Calendar titles are changed.

There is no appointment-to-opportunity inference. Do not choose a deal because its contact, name, date, status or pipeline looks plausible, including when only one opportunity currently exists. Project type, service, budget, arbitrary custom fields, notes and opportunity contents are excluded. A missing/unnamed/deleted contact keeps the original appointment title. Busy blocks never enter the contact lookup and remain private Busy labels.

The schedule provider makes the same three parallel requests for a bound owner and records only validated appointment/contact IDs in its private snapshot. After an explicit schedule refresh completes, a separate bounded `/calendar/names` request enriches that exact snapshot. Calendar controls and Results/Files switching remain usable throughout; failures leave the base schedule visible. GET/navigation never runs contact search, and no background timer or per-contact request is introduced. Closing or interrupting the optional name request can leave original names until the next explicit Refresh.

Contacts Search uses location-scoped OR groups of exact `id eq` filters, up to 100 contacts per batch and two batches in flight. The existing maximum of 1,000 events limits it to ten requests, one for Bruce's current two contacts. Every returned ID/location is checked; duplicates, ignored filters and incomplete responses fail closed. Each response is capped at 512 KiB, with one 20-second shared deadline. Only name/city survive projection; IDs, custom fields, opportunities, contact addresses and other response data remain absent from the browser. Official reference: [Search Contacts and its linked filter specification](https://marketplace.gohighlevel.com/docs/ghl/contacts/search-contacts-advanced/).

`20260912070000_client_portal_ghl_contact_titles.sql` adds an independent service-only title lease. It verifies portal/workspace access, connection revision and a unique calendar snapshot ID (`20260912080000_client_portal_ghl_title_snapshot_identity.sql` closes the same-timestamp race). Late completions cannot enrich a replaced snapshot, another month or a disconnected/replaced account. The title lease does not block a calendar refresh. Existing original event titles are preserved in storage, and the routine owner binding includes only company, timezone and owner metadata.

Verification: 934 repository tests, production build, changed-file lint, isolated SQL authorization/concurrency tests, and Chromium/WebKit at 1440×1000, 390×844 and 320×568. Browser fixtures covered exact titles, original-title retention, independent loading, Files/Results switching, month navigation during a delayed lookup, stale responses and lookup failures. Actual GHL data returned the two directly linked contacts and kept ten Busy blocks private. Physical iOS/Android devices were not tested; no platform-wide latency claim is made. The broader GHL milestone and richer appointment briefs remain open.
