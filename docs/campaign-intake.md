# Campaign lead intake

Betelgeze accepts leads from Scaylup's own landing-page funnels through one public address per **source**. A campaign has one or more sources, each one landing page with its own key, tag and booking settings (docs/campaign-booking.md). This is the first lead source for the Campaigns section. It is for Scaylup's own client acquisition only: a lead is a prospect for Scaylup and becomes a client later, when sold.

Status: live in production since 22 November 2026 (`CAMPAIGN_INTAKE_ENABLED=true`). With the switch off the address answers `503` and stores nothing.

## Address

```
POST https://app.betelgeze.com/api/campaigns/intake/<intake key>
```

Each source has its own intake key: 32 random URL-safe characters, created with the source. Campaigns created before sources existed became one source each and kept their key, so addresses already handed out keep working. The key appears in public page source, so it identifies the source but is not a secret. Protection comes from the origin list, validation, rate limits and the bot field below.

Send the body as `application/json`. Browsers send a CORS preflight first; Betelgeze answers it for the source's allowed origins only. A form posted from any other origin is refused with `403`.

## Body, version 1

Field names match the funnels' own form fields. All strings are trimmed. Unknown top-level fields are refused, so a typo fails loudly in testing instead of silently dropping data.

```json
{
  "version": 1,
  "submission_id": "6f0b8c1e-5a0e-4b6f-9d55-2f1c7a9e4b10",
  "offer": "teardown",
  "answers": [
    { "id": "trade", "question": "What kind of work do you do?", "answer": "Roofing" },
    { "id": "area", "question": "Where is your business based?", "answer": "Dallas-Fort Worth" }
  ],
  "contact": {
    "first_name": "Marcus",
    "last_name": "Hale",
    "company": "Hale Roofing",
    "phone": "(512) 555-0142",
    "email": "marcus@haleroofing.example"
  },
  "consent": {
    "agreed": true,
    "text": "By submitting, you agree to receive calls and texts from Scaylup about your request…"
  },
  "attribution": {
    "page_url": "https://scaylup.com/teardown/?utm_source=facebook&fbclid=…",
    "referrer": "https://l.facebook.com/",
    "utm_source": "facebook",
    "utm_medium": "paid",
    "utm_campaign": "teardown-tx",
    "utm_content": "before-after-video",
    "utm_term": "",
    "fbclid": "IwAR…",
    "fbc": "fb.1.1732200000000.IwAR…",
    "fbp": "fb.1.1732200000000.123456789"
  },
  "website": ""
}
```

| Field | Rule |
| --- | --- |
| `version` | Must be `1`. |
| `submission_id` | A UUID made once per form submission, before the first send. Resending the same ID (a retry or a double tap) returns the first result and creates nothing new. |
| `offer` | The funnel's own ID, 1 to 64 of `a-z 0-9 _ -`. Stored for reference; the intake key decides the campaign. |
| `answers` | 1 to 20 items. `id` uses the same characters as `offer`; `question` and `answer` are 1 to 300 characters. Send the question text as shown, so the lead page can show it without a mapping. |
| `contact.first_name` | Required, 1 to 80 characters. |
| `contact.last_name` | Optional, up to 80 characters. |
| `contact.company` | Optional, up to 160 characters. |
| `contact.phone` | Required. A US number: 10 digits, or 11 starting with 1, or `+1` and 10 digits. Stored as `+1XXXXXXXXXX`. |
| `contact.email` | Optional, up to 254 characters, must look like an address. |
| `consent.agreed` | Must be `true`. A lead without consent is refused, because it could never be texted. |
| `consent.text` | Required, 20 to 2,000 characters: the exact consent wording shown beside the button. It is stored with each submission together with its SHA-256, so every lead records what it agreed to. |
| `attribution` | Optional. Only the keys above. `page_url` up to 2,000 characters and must be `https`; every other value up to 500 characters. Read UTMs and `fbclid` from the landing URL, and `fbc` / `fbp` from Meta's `_fbc` / `_fbp` cookies when present. |
| `website` | A hidden field humans never fill. Leave it empty. When it has a value the request is answered as accepted and nothing is stored. |

The body may be at most 32 KB.

## Answers

| Status | Body | Meaning |
| --- | --- | --- |
| `202` | `{ "accepted": true, "reference": "<64 hex>" }` | Stored, or already stored under the same `submission_id`. |
| `400` | `{ "error": "…", "field": "contact.phone" }` | The body broke a rule. `field` names the first problem. |
| `403` | `{ "error": "…" }` | The page's origin is not on the campaign's list. |
| `404` | `{ "error": "…" }` | No campaign has this key, or it is archived. |
| `413` | `{ "error": "…" }` | Body over 32 KB. |
| `429` | `{ "error": "…" }` | Too many submissions from one address or for one phone in a short time. |
| `503` | `{ "error": "…" }` | Intake is switched off or could not store the lead. Nothing was stored. |

`reference` is an opaque identifier for this lead. The booking pages (next step) will accept it so the lead does not type their details twice. It is safe to pass in the booking page URL because it reveals nothing by itself.

Funnels must not wait on Betelgeze to move the visitor on: send, then continue to the booking page after the answer or after 2.5 seconds, whichever comes first. A lost answer is safe to resend with the same `submission_id`.

## What happens to a submission

1. The route checks the switch, the body size (32 KB, 10-second read limit), the origin and every rule above.
2. One database function, `campaign_intake`, runs as a single transaction:
   - finds the campaign by key; archived campaigns are refused;
   - returns the earlier result for a repeated `submission_id`;
   - refuses a ninth submission from the same address for this campaign within 10 minutes, and a fourth for the same phone within 10 minutes;
   - creates or updates **one lead per phone number per workspace**. A person who fills in two funnels stays one lead. Their first campaign and first attribution are kept; their latest answers, consent and contact details replace the earlier ones; the submission count goes up;
   - keeps every submission as its own receipt, including the consent text and its hash, the answers and the attribution;
   - adds a `submitted` event to the lead's timeline, which later drives the text sequences and the lead page.
3. A new lead starts at the `new` stage. Repeat submissions never move a lead backwards.

## Stages

`not_booked` → `paid_not_booked` (only when payment came in after the held time was taken) → `booked` → `showed` or `no_show` → `sold` or `lost`. Texted and Replied are activity shown on the card, not stages.

| Stage | Shown as | Set by |
| --- | --- | --- |
| `not_booked` | Not booked | Intake. Disqualified visitors never send a lead. |
| `paid_not_booked` | Paid, not booked | A Stripe payment for a held time that someone else took after the hold lapsed. The lead books again without paying. |
| `booked` | Booked | The booking page (directly, or once Stripe confirms payment), or staff. |
| `showed`, `no_show`, `sold`, `lost` | | Staff. |

Leads from a source in Testing are marked Test until a live source sends the same phone.

## Hand-off to the booking page

After a successful send, the funnel opens the source's booking page, `https://app.betelgeze.com/book/<booking address>`, and adds:

- `submission=<submission_id>` always. The funnel stores it before sending the lead, so it is there even when the intake answer was slow.
- `ref=<reference>` when the intake answer arrived (optional).

The booking page finds the lead from either. It takes the payment itself (docs/campaign-booking.md), so the funnel no longer links to a Stripe Payment Link. Without either parameter, the page asks the visitor to open it from the form.

The visitor's IP address is never stored. The route keeps an HMAC of it, used only for the rate limit.

## Storage

All tables are service-only: row level security is on and no browser role has any grant. The Campaigns screens read them on the server after checking owner/admin access and the pilot list.

| Table | Holds |
| --- | --- |
| `campaigns` | Name and status (`draft`, `live`, `paused`, `archived`). Its old intake key and origins are kept but no longer used. |
| `campaign_sources` | One landing page: name, tag, page address, allowed origins, status (`testing`, `live`, `off`), intake key, booking and payment settings. |
| `campaign_bookings` | Held and booked times, and their Stripe payments (docs/campaign-booking.md). |
| `campaign_leads` | One row per phone per workspace: contact details, stage, first and latest campaign and source, Test flag, first attribution, latest answers and consent, SMS consent state, submission count. |
| `campaign_lead_submissions` | One immutable receipt per accepted submission. |
| `campaign_lead_events` | The lead timeline. |

A paused campaign still accepts leads, so nobody who fills in a form that is still online is lost. Switching a source Off, or archiving its campaign, stops its intake.

## Setting up a campaign

Owners and admins on the pilot list (`CAMPAIGNS_PILOT_USERS`) set campaigns up in Campaigns: Sources → Add source, then the source's page (name and tag, landing page, what happens after the form, booking page, payment, and the address to send leads to). The service-only `campaign_admin` function behind those screens checks owner/admin access on every command.

## Release checklist

- Apply the migration, deploy, then set `CAMPAIGN_INTAKE_ENABLED=true`. Optionally set `CAMPAIGN_INTAKE_IP_SECRET` to a long random value; without it the IP HMAC is keyed with the service role key, and rotating either only resets rate-limit windows.
- Create the three Scaylup campaigns and paste each intake address into the funnels' `WEBHOOK` setting.
- Send one test submission per funnel from its real host and confirm one lead, one receipt and one event exist. Resend the same `submission_id` and confirm nothing new is created.
- Texts, booking and the Campaigns screens are separate steps; this change sends nothing to anyone.
