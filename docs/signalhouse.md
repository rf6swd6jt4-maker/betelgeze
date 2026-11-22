# SignalHouse texting for Campaigns

Status: pilot, behind `CAMPAIGNS_PILOT_USERS` like the rest of Campaigns (owners and admins only). This step connects SignalHouse, brings in its numbers and decides which number each campaign, source and lead texts from. **Nothing is texted automatically yet**: Text flows and the Comms Leads tab are later steps. The Comms Leads tab changes message reading and alerts, so it needs explicit permission under `app-alerts.md` first.

## What SignalHouse provides

Read from SignalHouse's API reference (https://app2.signalhouse.io/docs) and its public SDK (https://github.com/signalhouse-sms/sdk-py), November 2026:

- **Base URL** `https://v2.signalhouse.io` (override with `SIGNALHOUSE_API_BASE_URL`). `Authorization: Bearer <API key>`. An API key is a service-user JWT for one group, valid for 365 days. Writes send an `Idempotency-Key`.
- **Structure.** A group holds brands; a brand holds 10DLC registrations (SignalHouse calls them *campaigns*; Betelgeze calls them *10DLC registrations* so they are not confused with Betelgeze campaigns); numbers are attached to a registration. A number sends only while it is `READY` on an `ACTIVE` registration.
- **Reads.** `GET /group?id=`, `GET /campaign?groupId=&registrationType=TEN_DLC`, `GET /number?groupId=` (paged). Customer keys must always pass a filter. Each number carries `phoneNumber` (digits, `15125550199`), `campaignId`, `status`, `capabilities` and `health` (7- and 30-day sent, delivered, failed, opt-outs).
- **Sending** (later steps): `POST /message/sms` with `senderPhoneNumber`, `recipientPhoneNumber`, `messageBody`. `enqueuedCount` 0 means it was blocked (for example the recipient opted out).
- **Opt-outs.** SignalHouse enforces opt-outs by default (`optOutEnforcement`): it handles STOP/HELP and suppresses sends to opted-out recipients.
- **Webhooks.** One *Global* endpoint per group, made with `POST /webhook`. Every delivery is signed: hex HMAC-SHA256 of `${timestamp}.${rawBody}` in `X-SignalHouse-Signature`, timestamp (Unix ms) in `X-SignalHouse-Timestamp`, and `X-SignalHouse-Signature-V1: t=<ms>,v1=<hex>[,v1=<hex>]` carrying one signature per valid secret during a rotation. The signing secret is returned only when the endpoint is created or its secret rotated. Each delivery has `X-SignalHouse-Delivery-Id`, the same on retries. A receiver has 3 seconds; 5xx and 429 are retried up to 3 attempts in about 11 seconds, other 4xx are not. There is no replay; `GET /notification` is the durable record.

## In Betelgeze

- **Settings → Connections → SignalHouse** (`/[workspace]/settings/signalhouse`): connect with the Group ID and an API key. Connecting checks the key against the group, creates (or re-keys) one signed Global webhook pointing at `/api/signalhouse/webhook/<account id>`, stores the key and signing secret encrypted with `WORKSPACE_INTEGRATION_ENCRYPTION_KEY`, and reads the group's registrations and numbers. The page shows the account, its registrations, the numbers in use and the rules; **Add numbers** picks from the account's numbers; **Read again** re-reads; **Disconnect** removes Betelgeze's webhook from SignalHouse and forgets the key.
- **A number's page**: label, registration, what uses it, its last 7 days from SignalHouse, a test text to your own phone, and removing it from Betelgeze (refused while a campaign, source or lead uses it; it stays in SignalHouse).
- **Campaign → Text flows**: *Texts from* picks the campaign's number. **Source page → Texting**: the campaign's number, or the source's own. Only a number that can send is offered.
- **Lead page → Texts from**: the number that first texted them, else their source's, else the campaign's. A lead keeps the number that first texted them (`campaign_leads.sms_number_id`), so their replies stay in one conversation. Changing a campaign's or source's number while leads are texting with the current one asks whether they keep it (recommended) or move.
- **Webhook** (`app/api/signalhouse/webhook/[accountId]`): verifies the signature with that account's secret (refusing unsigned or stale deliveries with 401), stores the delivery once by its delivery id, answers 200, then re-reads the account after number or registration events (at most once a minute). Message events are stored for the Comms Leads tab; nothing changes message reads, unread counts or alerts.

## Data

Migration `20261124010000_signalhouse_numbers.sql`, all service-only (RLS on, grants revoked):

- `signalhouse_accounts`: one per connected group per workspace (more than one is allowed; the page shows the first). Holds the encrypted key and secret, key expiry, webhook id, status and last read/webhook times.
- `signalhouse_registrations`: 10DLC registrations as last read.
- `campaign_sms_numbers`: every number in a connected account; `added_at` while the workspace uses it, `removed_at` when it leaves. A number SignalHouse no longer lists is marked `RELEASED`.
- `campaigns.sms_number_id`, `campaign_sources.sms_number_id`, `campaign_leads.sms_number_id`: nullable; existing rows are untouched.
- `signalhouse_webhook_events`: each delivery once (`delivery_id` unique), with its envelope.

## Rollout

1. Apply the migration in production, then check that the four tables and three columns exist, with RLS on and grants revoked. **Before** merging: the campaign pages read the new columns.
2. Merge; check the SignalHouse page, a campaign's Text flows tab, a source and a lead.
3. In SignalHouse, create a service user API key for the group. In Betelgeze, connect with the Group ID and key, add the numbers, pick each campaign's number.
4. Send a test text from a number to your own phone; its delivery receipt should show as the webhook's last event within a minute.

Rollback: revert the application. The migration only adds tables and nullable columns; keep them (and their rows) rather than dropping them.

## Not in this step

Text flows (sending, quiet hours, waits), the Comms Leads tab and inbound reply routing (alerts permission needed), MMS, reconciling missed webhooks from `GET /notification`, connecting a second account from the page, and buying or registering numbers (done in SignalHouse).
