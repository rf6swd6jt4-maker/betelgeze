# Client portal reliability review

Status: implementation reviewed and deployment authorized. This document records the implementation and pre-release validation; production installation, exact deployment and live-client verification are separate release evidence. The candidate is on `codex/client-portal-reliability`, based on `e196186707ec7ddc8acf0e241d64df4e222f1656`, in the managed `client-portal-reliability` worktree. The original checkout and its unrelated work are preserved.

## Calendar freshness

The former calendar response represented one saved provider range independently of the retained appointment lifecycle. A lead count established that the CRM connection worked, but did not establish calendar coverage or appointment-detail freshness.

The candidate keeps up to six transient calendar/month ranges per relationship, scoped to the current connection revision. Initial navigation reads stored data. A visible active calendar quietly rereads once per minute and durably requests a provider refresh when its range is missing, incomplete or at least five minutes old. The existing scheduled appointment worker claims one range at a time after primary event processing and ready notifications, subject to its existing runtime budget and intake backpressure. There is no per-portal worker or new scheduler. Explicit manual refresh remains available.

The provider range controls the calendar rows, including title, time, status and membership. Calendar rows update after that range's provider refresh: approximately five minutes plus scheduler/provider/backlog delay while the portal is active. Opening a row reads the latest retained appointment directly, using the same record as its WhatsApp summary. Thus the list can temporarily show an earlier schedule while the opened details explain its current state. This is a freshness policy, not a guaranteed latency bound. First-time detail hydration admits at most ten IDs per worker turn and can take longer for large initial imports. Baseline imports do not send historical “new appointment” messages. A hydration flag shows admission progress, not a guarantee that every detail record has finished processing; a missing detail has an explicit retry state.

These are the user's explicit performance choices. The proposed two snapshot expression indexes were removed after an isolated write benchmark showed extra maintenance cost. The later existing-index overlay was also removed after the 1,000-row test showed 15–23 ms of extra database work per calendar read. Final calendar reads do not scan or join appointment history. A failed provider read preserves the last successful range and timestamp; stale empty data is not presented as proof that no appointments exist. Leases and completion are fenced by connection revision. Access loss clears incompatible browser state. Only transient range caches are evicted; appointment versions and message history are retained.

Automatic synchronization requires the existing deployment detection flag and functioning scheduled worker. The connection dialog calls out a disabled runtime. Saving credentials or selecting calendars does not claim fresh data or proven message delivery. Retained detail synchronization currently requires the existing verified custom portal domain contract; a default-host-only portal gets an explicit setup warning and does not accumulate an endlessly retrying detail hydration job.

The existing scheduler also recognizes due portal-only reconciliation, calendar ranges and optional note jobs, so a quiet client's refresh does not depend on another client's notification traffic. Scheduler enablement and notification flags remain unchanged. Older workers cannot claim portal-only jobs without the new capability marker; supported detection-enabled work remains available during rollout. An older snapshot that does not understand richer details retains the already-saved enrichment instead of erasing it.

## Shared appointment details and GHL retention

Calendar titles open an on-demand authorized detail read. The calendar remains mounted behind it; Back preserves the calendar, month and selected day. The restricted WhatsApp summary route and calendar use the same `ClientPortalAppointmentDetails` component, while keeping separate authorization paths. A notification URL includes the saved version, allowing the page to explain when newer details are now displayed. Cancelled and removed appointments remain readable through their retained summary links.

| Data | Retained/presented behavior |
| --- | --- |
| Appointment, calendar and contact identity | Exact GHL IDs, title, status, start/end, verified location time zone and source timestamps |
| Contact | Current saved name, phone, email, company and address; these are not described as original booking answers |
| Meeting | Bounded full meeting text and a validated HTTPS join URL when supplied |
| Assignment | Provider-assigned user ID is retained; a staff display name is not guessed |
| Booking text | Existing permitted short text remains supported; longer or unmapped text is explicitly withheld pending visibility review |
| Internal appointment notes | Optional staff-only durable storage, separate from portal/message projections; no client publication or staff browsing UI is introduced |
| Form submissions and custom answers | No association is inferred from a shared contact; a verified appointment-specific source/mapping is still required |

The main appointment adapter reuses its existing four provider reads. It does not fetch an entire contact history or add forms/opportunities to an interactive detail request. Phone is bounded to 80 characters, email to 254, company to 200, each address component to 250, meeting text to 4,000 and a safe join URL to 2,048. New fields do not themselves generate artificial lifecycle notifications. Original retained snapshots are not replaced with shortened WhatsApp text.

The optional notes lane reads five notes per page with an eight-second provider deadline, a 1.5 MiB response bound, up to 65,000 characters per note and a 1,000-note appointment cap that records partial coverage. It retains prior bodies and never treats an omitted row or failed response as deletion. It runs after primary notifications and calendar work only when time remains. The official [GHL appointment-notes API](https://marketplace.gohighlevel.com/docs/ghl/calendars/get-appointment-notes/index.html) documents the `v3` header and paginated notes/`hasMore` response; live credential/scope and payload acceptance still require release verification.

Automatic approval review rejected treating the existing `includeNotes` setting as permission to publish potentially internal CRM notes to clients. The implementation therefore keeps those notes outside client projections. This is a visibility boundary, not missing-data evidence.

## WhatsApp button evidence in BE Comms

New appointment-template messages retain the actual template identity, language, parameters, original button label, complete URL, appointment version and capture time at the existing atomic pre-dispatch boundary. Evidence is encrypted with the existing message payload and remains immutable across body edits, receipt changes and encryption-key rotation. The new worker fails closed before sending if the schema does not advertise evidence support.

BE Comms projects the safe button fields in the existing authorized bounded history response, without a per-message fetch. It displays the button label and shortened destination; the complete URL remains the explicit click target. There is no prefetch, click tracking, read-state ownership or new subscription. Prepared, accepted, delivered, read, failed and uncertain evidence remain distinct. A stored button proves what was prepared/sent with that message; it does not prove WhatsApp displayed the button or that the client clicked it.

Older messages stay intact and are not retroactively given guessed buttons. No historical message is resent. Approved template bodies remain concise through deterministic parameter shortening, while complete retained appointment data remains separate. The existing seven lifecycle kinds, consent, activation, version, live-template, provider-identity and uncertain-send fences remain in place.

## Meta reporting and future-client prevention

See [Meta reporting readiness and maintenance](meta-reporting-readiness.md) for the detailed flow and schema. A separate authorization candidate lets staff inspect client-scoped accounts and preview the exact selected account before an explicit confirmed save. The active account stays in place until that save succeeds. Lost acknowledgements reconcile the same candidate receipt; completed onboarding work and source references are preserved.

New onboarding requires an account preview and explicit business-account confirmation even when only one account is available. Old selections are preserved and marked unverified until reviewed. Parsing rejects malformed/missing metrics, error envelopes, wrong-account results, mixed currencies and dates outside the literal requested period; a valid empty result remains valid zero activity. Failed refreshes keep the last successful figures and their original timestamp.

Per the user's second performance choice, a legacy first report is displayed on the existing provider-read path without awaiting a new persistence round trip. Verified setup and explicit/background refreshes retain reports. Warm reads reuse those reports. Existing account indexes support exact canonical/`act_` alias checks; no new alias index is installed on existing connections. An upstream Windsor response timestamp does not establish how recently Meta itself refreshed its data.

No production account is hardcoded or rebound by this change. Jason's reported account mismatch requires the reviewed maintenance flow after an approved release. No new recurring monitor or automatic client-wide provider audit is activated.

## Verification and review boundaries

Synthetic unit, SQL and browser fixtures establish their named behavior only. They do not prove a production migration, real provider acceptance, authenticated deployed UI, physical Android/iPhone interaction or end-to-end production latency.

| Check | Result and limits |
| --- | --- |
| Full unit suite | 1,820/1,820 passed with serial test execution. An earlier parallel run under simultaneous browser/build load hit the existing short-deadline search retry test; its isolated rerun and the full serial rerun passed without changing that test or search code. |
| Production build | Next production webpack build passed with loopback placeholder credentials. No hosted build or deployment was started. |
| Changed-file gate | Historical migration integrity, four additive migrations, changed JS/TS lint and whitespace checks passed. |
| Browser Foundations | 970/970 assertions across 48 Chromium/WebKit fixtures passed. |
| Appointment/browser flows | Shared summaries: 36 state/viewport cases. Calendar: both engines at 320/390/1280, including back/retry, access loss, revision changes, stale ranges, label-only enrichment and zero redundant fresh-range admission. |
| WhatsApp evidence | 36 browser status/viewport cases; actual encryption, immutability, key rotation, receipt/body update and old-worker compatibility SQL checks passed. |
| GHL SQL | Disposable native PostgreSQL 18.4 suite passed with actual independent worker claims, observed connection-rotation lock waits, current-detail/WhatsApp equivalence, baseline hydration, retained versions, permissions/revocation and 25,000-row queue growth. |
| Meta | 48 focused tests; 12 PGlite and 13 native PostgreSQL checks; Chromium/WebKit at 390/1280. Native checks include competing commits, receipt recovery and 5,000-account/10,000-history index plans. |
| Protected Comms behavior | Existing unread SQL, encrypted native inbox and push recovery suites passed. Message reads, unread ownership, push eligibility and subscriptions were not changed. |

Browser performance evidence uses the actual calendar component against identical synthetic responses, alternating baseline/candidate runs and separating cold opening from cached navigation. It records five cold observations, twenty day switches and forty month switches per arm/cohort, with zero cached-navigation requests. The fixture cannot certify production latency or payload size. Its browser build differs from Next's deployed chunk splitting. Rapid repeated selector timings were excluded because the baseline selector also failed that fixture sequence; functional cached selection passed. The initially broken mobile detail screenshot was caused by an unscoped fixture CSS-module stub, not production Next CSS. The fixture now scopes modules and asserts one-column, non-overlapping readable fields; both corrected engine screenshots were inspected.

Review artifacts in the worktree: `browser-results/foundations.json`, `browser-results/ghl-calendar-performance/all.json`, `browser-results/ghl-multiple-calendars/webkit-detail-390.png`, and `browser-results/whatsapp-template-evidence/webkit.png`. These are local evidence files, not public client data.

The candidate adds four migrations in dependency order:

1. `20261022010000_ghl_portal_calendar_freshness.sql`
2. `20261022011000_ghl_appointment_details.sql`
3. `20261022012000_whatsapp_template_evidence.sql`
4. `20261022013000_meta_reporting_readiness.sql`

Existing immutable migrations remain unchanged. Apply additive schema before the new app in a future approved release. Existing functions remain for older callers. A rollback must retain new data/history, successful account selections and accepted jobs; revert application use rather than deleting retained tables or rewinding client configuration. Do not retry an uncertain external send.

Before release, verify worker availability and flags, migration installation/ACLs, real GHL payloads and notes scopes, Windsor account/metric/date behavior, the versioned URL with the live approved WhatsApp template, the correct client-scoped account selection, and mobile navigation on physical devices. Use a controlled test only with explicit authorization to send. Exact-candidate hosted CI and production verification are recorded separately from the local results above.
