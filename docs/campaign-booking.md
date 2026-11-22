# Campaign sources, booking pages and payment

Campaigns is Scaylup's own lead CRM for its ad funnels (docs/campaign-intake.md covers how leads arrive). This document covers what happens after the form: the source a lead came from, its booking page, the held time, and the Stripe payment that confirms it.

Status: pilot. Campaigns is shown only to people listed in `CAMPAIGNS_PILOT_USERS` (comma-separated user IDs, or `all`) who are owners or admins of the workspace; anyone else gets a 404. Text flows (SignalHouse) and the Comms Leads tab are later steps; nothing here sends a text.

## Model

- A **campaign** has one or more **sources**. A source is one landing page: its own intake key, a tag (name and colour) that marks its leads, allowed origins, and a status (`testing`, `live`, `off`). Leads from a Testing source are Test leads.
- **After the form** a source either collects leads (they wait in Not booked for the team) or collects and books (visitors go to its booking page).
- A booking source has a public **booking page** at `/book/<booking address>`: meeting name, length, place, time zone, days, hours, notice and how far ahead. Each source keeps its own times; two sources can book the same hour.
- A booking source may **take payment**: an amount (at least $0.50), how long a picked time is held (10, 15, 20 or 30 minutes), and a refund rule shown on the page.

## Booking flow

1. The funnel opens `/book/<address>?submission=<submission_id>`. The page finds the lead by the submission (or `ref=<reference>`). Without either it asks the visitor to open it from the form.
2. The page offers times from the source's hours in its time zone, minus times already booked or held. `lib/campaigns/slots.ts` builds them; `campaign_booking_hold` checks the chosen time again (day, hours, step, notice, horizon) before anything is stored.
3. **No payment:** the time is booked at once and the lead moves to **Booked**.
4. **With payment:** the time is **held** for the source's hold length and the lead stays **Not booked**. Betelgeze creates a Stripe Checkout page on the workspace's connected Stripe account (`createStripeBookingCheckout`, metadata `campaign_booking_id`) and sends the visitor there. If the Checkout page cannot be created, the hold is released at once.
5. Stripe's `checkout.session.completed` (or `async_payment_succeeded`) reaches the existing webhook (`app/api/stripe/webhook`), which verifies the signature and records the event as before, then calls `campaign_booking_paid` once. If the time is still free (even after the hold lapsed) it is **Booked**; if someone else took it meanwhile, the lead is **Paid, not booked** and books again without paying. A resent event changes nothing.
6. Stripe returns the visitor to the booking page with `paid=1`. The page shows "Confirming…" and refreshes itself a few times until the booking appears, then stops.

A lapsed hold gives its time back the next time anyone holds at that source. The pipeline and lead page ignore lapsed holds. Stripe keeps a Checkout page open for at least 30 minutes, so a payment can arrive after a 20-minute hold; step 5 covers it.

## Screens

- **Sidebar (Today layout):** a Campaigns section between the destinations and the clients lists each campaign by name with how many of its leads are not booked, and + opens New campaign. It reads `/api/workspaces/<slug>/campaigns/rail` (two bounded reads) after the shell is up, never before, and again when the window returns after five minutes or a campaign it does not list is opened. In the tabbed layout and the phone's More menu, Campaigns is one destination.
- **Campaign page:** a header shaped like a client's (status, its sources' tags, how many are not booked, Go live or Pause), then Pipeline, Leads, Sources and Text flows. A campaign goes live only once one of its sources is Live. Pipeline and Leads filter by source tag.
- **Source page:** status and what moves it on. In Testing: the steps before it goes live (a page address, then a first lead) and **Send a test lead**, which runs the real intake with a fixed 555 phone per source, so the lead is a Test lead and its booking page opens with a real submission. Live: Back to Testing or Switch off. Then its settings, saved field by field.
- **Lead page:** stage and Mark sold in the header; the appointment and activity, and beside them contact, form answers, payment and source. With no time booked, **Book for them** opens the lead's own booking page (by their reference) and **Copy their booking link** copies it.

## Staff actions

All through `campaign_admin` (owner/admin, checked in the database): create and edit sources, move a lead between stages, and mark a booking Showed, No-show or Cancelled. Only a payment makes Paid, not booked, and only a booking makes Booked. Moving a lead out of Booked, or cancelling, frees the time (a paid lead goes back to Paid, not booked).

## Not in this step

Google Calendar and Zoom links per booking, rescheduling links, text flows, the Comms Leads tab, and recording refused submissions per source. Booked times live in Betelgeze only.

## Checks

- `scripts/validate-campaign-intake-sql.mjs` replays every migration and checks intake, sources, holds, payment, late payment, cancelling and access.
- `tests/campaign-booking.test.ts` checks time-zone conversion, offered times, the pilot gate and display helpers.
- Not checked automatically: the signed-in screens, a real Stripe payment and the webhook from Stripe. The $1 test covers them.
