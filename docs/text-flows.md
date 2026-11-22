# Text flows

Status: built (pilot, behind `CAMPAIGNS_PILOT_USERS`, owners and admins only). Apply `20261125010000_campaign_text_flows.sql` in production before the application: the pages read its columns. The design is the Campaigns
mockup, version 7 refined in 8 (https://claude.ai/artifact/Rx3Yx6tFBYkAoGKgYvmjMm, "Text flows"). On 22 November 2026
the user asked to "make it the same as the mockup" and decided four open points:

- **Setters:** leads get a Setter, shown on the lead page and pipeline cards. A source can name a default setter for its
  new leads. Flows use `{setter_first_name}` and "Assign them to a setter".
- **Call tasks:** "Add a call task" puts a **Call** mark on the lead: on the pipeline card and the leads list, with a
  Calls view, cleared when someone marks it called. Nothing goes to Today.
- **Pictures:** a text step can carry a picture, sent as MMS.
- **Confirm now, reschedule later:** appointments get a **Confirmed** mark (a reply word or the "Mark the appointment
  confirmed" action). `{reschedule_link}` is not offered until rescheduling exists.

## What a flow is

One flow belongs to one campaign:

- **Starts when:** a lead comes in, holds a time without paying, books a time, is marked no-show, or moves to a
  chosen stage. It can be limited to some sources. A hold flow only applies to sources that take payment.
- **Steps run in order:**
  - **Send a text:** fields and an optional picture.
  - **Wait:** a set time, until 9:00 AM the next day, until N hours before the appointment, or until the hold runs out.
  - **Only continue if:** they haven't booked, replied or paid, or their appointment is still on. Otherwise the flow
    ends for them.
  - **Action:** add a call task, move them to a stage, assign a setter, or mark the appointment confirmed.
- **Replies:**
  - STOP and HELP are fixed. SignalHouse answers both (`optOutEnforcement`), and STOP opts the lead out of every
    flow.
  - Reply words (exactly, any case) can confirm the appointment, add a call task, stop the flow, or move the lead to
    Lost.
  - Any other reply stops the flow when "They reply" is ticked. Otherwise the flow carries on. Every reply shows in
    Comms either way.
- **Stops when:** they reply, book or pay (each a checkbox). Being marked Sold or Lost always stops it, and so does
  texting STOP.
- **Sending:** texts go out only between the flow's hours, on its days, in the lead's own time zone (from their area
  code, else their source's time zone). A text due outside that window waits for the next opening.
- **Each lead is in a flow once at a time.** Editing a flow saves as you go, and leads already in it get the new
  version from their next step.

The editor matches the mockup:
- **Checks:** a segment counter per text (GSM-7 or UCS-2), a filled-in preview per text with "Fill in as", and
  warnings for empty texts, unknown fields, fields the trigger lacks, appointment waits without a booking, and no
  sources. A flow cannot be switched on while warnings remain.
- **Tools:** Preview, Send me a test, the "In this flow now" list with Take out, Duplicate and Delete.

Fields:
- `{first_name}`, `{business}`, `{setter_first_name}`, `{booking_link}`: always available.
- `{appointment_time}`, `{hold_until}`, `{payment_link}`: hold flows.
- `{appointment_time}`, `{meeting_details}`: booking flows.

## How it runs

- **Tables:** `campaign_text_flows` (settings and steps) and `campaign_flow_runs` (one row per lead in a flow: its
  step, when it is next due, and how it ended).
- **Starting:** database triggers on `campaign_leads` and `campaign_bookings` start runs and apply the stop rules, so
  every path (intake, booking page, Stripe, staff actions) behaves the same without changing those functions. A run is
  due at once.
- **Sending:**
  - A minute scheduler (`pg_cron` → `POST /api/cron/campaign-flows`, the same pattern and secret as the other
    workers) claims due runs with a lease and works through their steps until a wait, the window or the end.
  - The intake and booking routes also kick the worker after answering, so an instant reply does not wait for the
    next minute.
- **Texts:**
  - Flow texts are sent from the lead's number (sticky, as for hand-sent texts) through SignalHouse: `/message/sms`,
    or `/message/mms` as form data with the picture uploaded as `images`.
  - Each is stored as an outbound message in the lead's Comms conversation, from their setter (else the flow's
    author), with a request id derived from the run and step, so a retry never sends twice.
  - A picture is copied into the conversation as an ordinary encrypted image attachment.
- **Alerts:** flow texts are outbound, so they alert nobody, as for every outbound lead text (`app-alerts.md`, 22
  November 2026). Replies alert exactly as before. Flows change no read, unread or alert rule.

## Speed assessment (app_speed.md §2)

- **Pages:**
  - The campaign page reads its flows and their run counts (one indexed query each) in parallel with its other reads, because its tabs switch in place without another read. On Pipeline and Leads it also reads the owners' and admins' names for the setter on each card.
  - The flow editor reads one flow, its campaign's sources and the leads in it.
  - The lead and source pages read the setter, Call mark and Confirmed mark from rows they already load, plus the owners' and admins' names in parallel.
  - No other page, tab or Comms path gains a request.
- **Writes:**
  - A lead insert, stage change or booking change runs one trigger. It does an indexed read of the campaign's enabled
    flows (a handful of rows) and at most a few inserts or updates of runs, which adds well under a millisecond to
    those transactions.
  - Saving a flow is one update.
- **Background:**
  - A one-minute scheduler and its worker run outside every request.
  - The worker claims at most 50 due runs per call, using `FOR UPDATE SKIP LOCKED` and a two-minute lease.
  - The after-response kick adds no latency to the intake or booking answer.
- **Comms:** flow texts are ordinary lead messages, with no new subscription, read or count.

## Not in this build

`{reschedule_link}` and rescheduling, round-robin setters, link tracking or shortening, inbound MMS (inbound pictures
show as their text only), and reconciling missed SignalHouse events.
