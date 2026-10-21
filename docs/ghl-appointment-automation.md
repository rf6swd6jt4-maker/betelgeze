# GHL appointment summaries and automation

Implementation candidate dated 20 October 2026, branch `codex/ghl-private-app`. This document describes the implementation; deployment, installation and actual delivery are separate evidence.

**Sending defaults off.** The private GHL app is Live (1.0.0, zero installs on 20 October). OAuth secrets are saved in Vercel production settings. Backend release evidence is recorded separately below. The seven Meta templates were subsequently approved; the worker still requires live `APPROVED` and `UTILITY` before every dispatch. No client is connected or activated automatically. Local tests do not establish provider delivery.

## Implemented lifecycle

| Situation | Detection and retained state | Notification |
| --- | --- | --- |
| New appointment / move into selected calendar | Signed `AppointmentCreate`, update or reconciliation; exact occurrence lookup | `be_appointment_added` |
| Reschedule | Compare retained start, end and timezone with a fresh provider snapshot | `be_appointment_rescheduled`, including previous and current schedule |
| Cancellation | Status changes to cancelled/canceled | `be_appointment_cancelled`; supersedes old queued notices/reminders |
| Deletion / move out | Exact-ID 404, verified explicit `deleted: true`, or verified different calendar; retain previous details | `be_appointment_removed`; no duplicate removal after an already dispatched cancellation |
| Detail change | Compare appointment title, contact identity/details, calendar name, meeting details and configured booking details | `be_appointment_details_updated` |
| Other status change | Compare actual provider statuses, including restored/attended/no-show/invalid | `be_appointment_status_updated` |
| Reminder | Due-time job for new/confirmed future appointments, then a fresh point read before dispatch | `be_appointment_reminder`; one dispatch per scheduled start, including uncertain sends |

Concurrent changes use one primary notice, in removal/cancellation/reschedule/status/details order. Each summary displays the complete latest saved state. Edits to an already cancelled appointment are labelled as detail changes with its cancelled state retained, never as an active reschedule. Initial imports suppress only notices for previously unknown appointments; subsequent changes remain eligible. Recurring occurrence IDs are preserved rather than collapsed to a series ID. Deleted appointments without a retained version require review; no missing details are invented.

The recipient is the configured **Betelgeze business-client relationship**, not the GHL appointment contact. The contact supplies appointment information only.

## Exact appointment links

The submitted button opens `https://portal.scaylup.com/appointment/<64-hex-reference>`. Proxy permits the public route only on the currently verified client-portal hostname and rewrites to `app/client-portal/appointment/[token]`.

A service-only scoped read validates the reference, current workspace/domain, relationship, active portal session, portal-token fingerprint and revocation before returning one retained appointment. The reference cannot open the general portal or another appointment. Ordinary reschedules preserve its identity. Portal token rotation/revocation invalidates old summary references. Calendar/location reconfiguration preserves old profile histories and their scoped links; a reused provider event ID in a new calendar cannot overwrite an old summary.

The page includes appointment/contact details, schedule/timezone, status and saved freshness. Cancelled/removed views retain history. It performs no GHL request or calendar bootstrap, adds no polling, excludes appointment information from preview metadata, and uses private no-store and no-referrer headers.

## Intake, processing and dispatch

- `POST /api/integrations/calendar/events` (alias of `/api/webhooks/ghl/appointments`): verify the exact raw bytes using HighLevel's published Ed25519 key and `X-GHL-Signature`, stream at most 1 MiB with a 10-second body deadline, validate identity, then commit to the durable inbox before acknowledgement. Legacy RSA is not accepted. A disabled endpoint returns an explicit disabled result and does not retain events.
- Durable intake starts immediate processing through Next `after`, scoped to the event's location/appointment. It does not wait for cron. Each immediate pass handles up to five events and four notices, claiming sends individually. GHL webhook latency, provider availability and backlog still prevent an absolute delivery-time guarantee.
- `GET` or `POST /api/cron/ghl-appointments` authenticates with `SOP_WORK_CRON_SECRET` (legacy `CRON_SECRET` fallback), returns 202, then processes up to five events, one reconciliation page, twenty reminder checks and two notifications. Failures remain durable for recovery.
- The additive scheduler registers one-minute appointment recovery and five-minute OAuth renewal through existing pg_cron/pg_net. Both start disabled. It reuses the existing Vault cron credential and avoids idle HTTP calls. Activate with service-only `set_ghl_scheduler(true)` after deployment. A one-minute tick does not guarantee every queued notification arrives within a minute.
- ContactUpdate retains routing identifiers only and fans out to at most 20 retained appointments per durable pass. UNINSTALL disables matching app/location or company bindings and profiles in bounded passes.
- Reconciliation alternates daily discovery windows (seven days back through about ninety days ahead) with bounded point verification of retained identities. Native events can introduce appointments outside this horizon. It uses durable keyset cursors, backpressure and fresh sweep identities. List omissions never imply deletion; a capped/malformed list fails without advancing coverage. Recovery latency depends on backlog and the scheduler and must be measured in the isolated pilot.
- `public.ghl_appointment_automation` owns service-only profile configuration, inbox/outbox leases, optimistic version checks, retained versions, supersession, capabilities, reconciliation and dispatch. All new tables live in `client_portal_secure`, are RLS-protected and have no direct application-role grants.
- Dispatch rechecks current connection revision, active relationship/workspace, current WhatsApp consent and STOP state, portal capability, appointment version, pending events, expiry, the explicit sending flags and live template identity/category/language/body/button/TTL. It checks the expected WABA again in the canonical sender. Ordinary reconfirmation exceptions are not reused as notification consent.
- The canonical encrypted `client_messages` row, provider delivery row and dispatch-start fence commit atomically. The existing Meta sender receives the canonical message ID as callback data. A lost or unclear acknowledgement is quarantined; it is never automatically resent. Fast delivery/read/failure callbacks keep their authoritative status when the worker's acknowledgement arrives later.
- Notices expire after one hour; reminders after thirty minutes or appointment start, whichever comes first. Pre-activation and expired notices are excluded before the claim limit, so they cannot delay fresh notices after activation. Meta acceptance is distinct from delivery/read receipts.

## Field mapping

Point reads verify location, exact event, calendar and linked contact. Requests use API `Version: v3`, a shared 20-second deadline, no redirects, no caching and bounded JSON. Permission, rate-limit, timeout and malformed-response failures are retry/review cases, never deletions.

| Message value | Source |
| --- | --- |
| Calendar / appointment name | Verified calendar name / appointment title |
| Contact name / contact details | Exact `contactId` lookup; name, phone and email |
| Schedule / timezone | Offset-qualified appointment start/end; appointment/calendar/location timezone |
| Status | Appointment status; never infer attendance from elapsed time |
| Meeting details | Appointment `address`; never substitute the contact's postal address |
| Booking details | Appointment `notes` only when profile `includeNotes` is explicitly boolean `true`; otherwise states that booking details are not configured |
| Previous schedule/status | Retained previous appointment version |
| Changed details | Bounded comparison of the two verified versions |
| Summary button | Opaque appointment capability, never a general portal token or provider ID |

Review actual appointment notes before opting in: they may contain internal or promotional content. Contact custom fields are not assumed to be booking-specific answers. No notes mapping is activated here. Oversized or unsupported message parameters are blocked for review rather than silently truncated or sent as unrestricted text.

## Private app connection and activation

The app has six read-only scopes: locations, contacts, opportunities, calendars, calendar events and users. The callback is `https://app.betelgeze.com/api/integrations/calendar/callback`; the neutral URL satisfies GHL white-label validation. The OAuth credentials are `GHL_OAUTH_CLIENT_ID`, `GHL_OAUTH_CLIENT_SECRET`, `GHL_OAUTH_APP_ID` and `GHL_OAUTH_INSTALL_URL`, gated by `GHL_OAUTH_ENABLED`.

A 20-minute secure HTTP-only cookie binds random state to the browser, BE user, workspace, relationship, exact connection revision and app configuration. Only one callback can exchange the code. Company grants support installed-location discovery (at most 50 choices plus exact-location lookup) and conversion into a renewable Location token. Tokens never return to the browser. Saving a calendar reuses the existing connection command, Vault access-token path, duplicate protection and retirement history. Existing private integration tokens remain supported but do not install webhook subscriptions.

Refresh credentials are encrypted. The worker claims one at a time; unknown single-use refresh outcomes require reconnection. Renewal preserves the calendar revision and cannot overwrite a manual token replacement. Retirement and uninstall fence renewal. No existing client is migrated automatically.

A completed connection creates a detection profile with sending off. A profile-setup failure is reported separately from the committed connection; retry repairs it without redeeming the code again. Activation requires the current OAuth connection, calendar read, verified `portal.scaylup.com` domain, active portal, confirmed WhatsApp consent and all seven live approved template contracts. Other portal domains or WABAs need corresponding approved templates. Both global detection/sending flags and the per-client flag must allow dispatch.

Confirmed opt-in and the 24-hour free-form window are different: utility dispatch checks active confirmed consent and STOP/revocation, **not** `canSend`. The SQL fixture uses consent confirmed 30 days ago with `canSend=false` and still exercises successful utility dispatch. Missing or revoked consent remains blocked. `tested_at` records activation preflight, not actual device delivery. Activation uses a fresh boundary and never drains old test notices.

Apply only this candidate's six additive migrations after validation. Historical migrations and client data remain unchanged. The staff API supports start, session recovery, location/calendar selection and notification status/enable/disable. Client Connections now opens an on-demand app dialog: choose the client, authorise in a new HighLevel tab, return to select the installed sub-account/calendar, then explicitly enable WhatsApp. A blocked popup leaves an ordinary authorisation link. Existing tokens, calendar controls and retirement remain under Manual connection. Notification status is fetched only for the opened client, never for every list row. Lost-save recovery resumes the existing server attempt; it does not redeem a second location token. Bruce and Jason's installations and real delivery tests are reserved for the user.

## Operations and rollback

Monitor indexed pending/blocked/uncertain rows, oldest queue age, expired leases, quarantined intake and cron failures. Review IDs and safe diagnostic fields through trusted admin tooling; do not log raw payloads, appointment/contact details, portal capabilities or credentials. Keep the rate of fresh/reconciliation work within the tested budget. Unknown sends require provider/receipt reconciliation, not resetting their status to pending.

To stop dispatch, unset `GHL_APPOINTMENT_SENDING_ENABLED` and disable the profile sending flag. Detection may continue retaining changes. To stop intake/processing too, unset `GHL_APPOINTMENT_DETECTION_ENABLED` and disable profile detection. `set_ghl_scheduler(false)` stops scheduled work. Already in-flight provider requests cannot be recalled. Preserve inbox, versions, references, outbox and Communications records; no destructive down migration or history cleanup is provided.

## Validation evidence

- GHL UI verified private version **1.0.0 Live**, zero installs, on 20 October. Private publication required scopes, redirect URI and client key and completed immediately.
- Vercel OAuth ID/secret are production Secret variables; app ID/install URL are production configuration. Stored settings alone do not prove a new runtime deployment.
- Production preflight confirmed Vault, pg_cron, pg_net, the existing cron credential, connection commands and message-encryption trigger. New GHL tables/functions were absent. This project has no `supabase_migrations.schema_migrations` table; use catalog verification and explicit release evidence without inventing history.
- The unit suite covers signature/lifecycle/provider/template rules, cookie/user binding, duplicate callbacks, renewal identity, committed connection versus setup failure and uncertain sends. Actual migration SQL fixtures cover consent outside the free-form window, grants, leases, CAS, retained histories, contact fanout, uninstall and scheduler gates. Native PostgreSQL CI repeats these using independent connections for callback and worker races. Synthetic Vault and consent helpers remain adapters, not proof of live encryption/provider integration.
- Browser foundations passed in Chromium and WebKit. Summary components passed **30/30** scenarios across 320, 390 and 1280px, zero API/provider requests and no horizontal overflow. These are synthetic fixtures, not authenticated production or physical devices.
- Existing portal/calendar views gain no requests. New background claims are bounded and indexed; selective calls use custom plans. Growth fixtures retain 25,000 unrelated pending events and 25,000 expired notices and inspect the actual claim SELECT plans. Production latency and sustained queue growth remain unmeasured.
- The new dialog has isolated Chromium/WebKit coverage at 320, 390 and 1280px for authorisation fallback, sub-account/calendar selection, explicit enable/disable and lost-save recovery. Existing manual and retirement workflows and relationship-filter draft ownership are separately exercised. These do not establish real GHL installation or device delivery.
- Final candidate CI, schema installation, exact production deployment and HTTP smoke evidence must be recorded before declaring the backend released. Actual installation, signed webhook arrival, all seven live template sends and device receipt remain pilot checks.

Reproduce with `npm test`, the foundation changed-file lint gate, placeholder `next build --webpack`, both browser runners, and the GHL SQL scripts with `BE_PGLITE_ROOT` pointing to isolated dependencies. Native SQL checks additionally use `BE_GHL_NATIVE_PG=1`, `BE_PG_ROOT` and reviewed `BE_RECORDS_PG_BIN`; they create fresh socket-only clusters and accept no production database URL.

The exact template contract is [recorded here](ghl-whatsapp-template-submission-2026-10-11.json). Provider references: [webhook verification](https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/), [appointment point reads](https://marketplace.gohighlevel.com/docs/ghl/calendars/get-appointment/), [calendar event discovery](https://marketplace.gohighlevel.com/docs/ghl/calendars/get-calendar-events/).


## Multiple calendar selection (21 October 2026)

The app connection can select one to ten calendars in one authorised location. `Edit calendars` reads the existing saved credential; it does not start another installation. Selection commits compare the connection revision and retain a request receipt. Retrying a lost acknowledgement recovers the committed choice before any new provider work. Existing single-calendar rows use a read-time fallback; the additive migration does not rewrite their data or enable sending.

The portal presents one calendar at a time. Its existing snapshot and six-entry resident cache are keyed by calendar plus month; a changed connection revision or explicit access denial clears stale entries. Opening the portal still reads one stored snapshot. An uncached explicit calendar/month switch performs the existing one-calendar provider read, respecting the existing cooldown. Save and notification-enable preflights check every selected calendar in pairs, so those explicit operations grow with the selection (maximum ten), while ordinary portal reads do not fan out.

One notification profile handles the selected calendars. Its existing primary calendar remains the history anchor while selected. Moving an appointment between selected calendars produces an update under the same appointment identity; moving outside the selection can produce a removal only with retained evidence. Removing a calendar from the configuration does not announce its historical appointments as removed. Reconciliation rotates one selected calendar per bounded discovery turn, retaining the existing ten-ID page and interleaved known-identity check. Additional calendars lengthen the fallback sweep; webhook intake and immediate processing remain the primary route. All seven existing Meta template contracts and dispatch/consent gates remain unchanged.

Calendar discovery now explicitly requests `showDrafted=true`. A live read of North Texas Shutters returned one calendar with the previous false filter and eight with this filter, including the saved NTS estimate calendar. Seven returned `isActive=false`; labels show `Inactive / draft`. GHL accepted the draft estimate calendar's event and blocked-slot reads (empty windows). Selection does not activate or publish a calendar, and these reads do not prove GHL webhook emission or WhatsApp delivery for a future booking.

Local evidence: 1,776 tests; actual database-function fixtures for multi-selection authorization, revision races, durable save recovery, portal calendar fences, shared appointment history, old-consumer rejection and reminder deduplication; actual UI fixtures in Chromium/WebKit at 320/390/1280px for OAuth return, editing existing installs, inactive choices, ten-calendar bounds, portal switching, cache isolation and access-loss clearing. Native PostgreSQL concurrency and the complete hosted release suite are required for the candidate commit before production advancement. These are synthetic send tests; no real client notification is generated for validation.

Rollback must retain a worker that understands multiple calendars or disable affected profile processing. The database rejects older event/dispatch consumers on multi-calendar profiles before they can mistake a secondary calendar for a removal. Preserve selections, inbox, snapshots, outbox and migration history. The previous single-calendar application remains compatible with existing one-calendar profiles only.

## Retained WhatsApp consent compatibility (21 October 2026)

Appointment activation and atomic dispatch use the same service-only template-consent resolver. Existing canonical confirmations remain authoritative; the fallback recognises the latest confirmed sale only when its `relationship_channels` evidence selects WhatsApp for the exact current number in the same workspace and relationship. Deleted evidence, changed numbers, archived relationships, STOP, explicit revocation and unhealthy integrations remain blocked. An ordinary inbound conversation alone is not treated as permission.

This fixes all clients using that retained consent format without editing sales, confirmation timestamps, message history or notification flags. Free-form `canSend` and the 24-hour window owner are unchanged. Older returning confirmation replies need no replay or resend because their retained channel-selected consent is evaluated directly. Both setup and send-time checks use this resolver; correcting the button alone would leave dispatch broken.

No new browser requests, provider calls, background jobs or indexes are added. Already-recognised confirmations return through the existing path. Previously blocked legacy cases use one indexed latest-sale lookup, projecting only the evidence fields; fixtures verify the existing partial index with 25,000 unrelated records. Regression fixtures cover expired windows, current phone matching, workspace isolation, opt-outs, revocation, deleted evidence, degraded/disabled integration and actual atomic dispatch. Release and live read-only verification are recorded separately. No notifications are enabled or sent by this migration.
