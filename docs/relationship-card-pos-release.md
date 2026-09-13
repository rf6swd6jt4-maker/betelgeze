# Relationship detail and centered POS revision

13 September 2026. This revises SS-02/03 before the SS-04 multiple-session work in [the Tuesday-linked plan](service-stage-revamp-plan.md).

The relationship retains its header, with current and potential monthly retainers in its bottom row. Current value uses active sold work and frozen sale pricing; potential value means unsold Negotiating services, excluding Declined. Different currencies remain separate and non-monthly catalogue schedules are normalized to monthly equivalents. The former value cards and messaging-confirmation block are removed.

Fields precede the independent service History chart. Queue occupies the left column on wide desktop; Services and Contact occupy the right. They stack on mobile. Thumbnail cards open shared centered dialogs, with a catalogue list behind Add service. Contact cards expose numbers, confirmation and last-message metadata, copy/mail/call controls, and the client portal link for users with full relationship coverage. Unconfirmed services/channels are grey; previously confirmed unhealthy providers are red. Creation requires email or phone; checkout still requires a billing email and a confirmed messaging destination.

The native service POS opens in a centered dialog, including entry from the old native POS URL. The clicked service is selected automatically. Three steps cover monthly/upfront prices and staff, the published onboarding composition and actual preview, and selected delivery channels. Only a committed sale declines unchecked reviewed opportunities; Declined services remain sellable. For later is removed from new choices, with historical data retained. Existing legacy relationship-wide POS behavior remains a compatibility path until the planned cutover.

## Correctness and recovery

- The shared relationship background queue still owns contact and field drafts. It is flushed before opening the POS or attaching/sending a contact. Location is added compatibly to older nine-field commands.
- Sale drafts are scoped to account, workspace and relationship. Pending submissions retain the original request, immutable quote and recovery receipt. Stale checked or unchecked service versions abort the entire sale.
- Selected destinations are frozen in the atomic sale/outbox transaction. Retry reuses existing per-provider receipts and never redirects a queued link to a newly edited phone number. Queue acceptance is distinct from provider completion.
- Confirmation requests have durable claims, address-specific proof, retry/uncertain states and webhook replay protection. Incoming confirmation replies are logged atomically in Communications. SMS retains workspace opt-in and STOP enforcement.
- WhatsApp confirmation remains visible after its messaging window expires, but free-form onboarding delivery requires a recent client reply. A fresh approved confirmation template can reopen that window. An old webhook replay cannot confirm a later request.
- Native dialogs and nested selectors use the same top layer, including the full published onboarding preview. Access checks remain server-side; contact metadata and commands are unavailable to anonymous/authenticated RPC callers.

## Validation and performance

- 960 repository tests passed; scoped ESLint, diff checks, and the production Webpack/TypeScript build passed.
- 19 SQL fixture groups pass against the real migrations. Coverage includes composition, authorization, concurrency, declined resale, delivery identity, confirmation replay and window expiry, message retention, payment isolation and rollback.
- With 50,000 historical messages, the recent-contact query uses the time-bounded inbound index (0.153 ms observed in isolated PGlite; this is not production or end-to-end latency).
- Chromium and WebKit fixtures passed at 320, 390, 639, 640 and 1280 CSS pixels. They covered overflow, dialog bounds, card selection/prices, nested selectors, onboarding preview and cancellation without submission. These are browser emulation results, not physical-phone results.
- Header/fields retain their resident authorized data. POS and published preview code are loaded on demand. Card metadata and contacts load only when visible; history loads only when expanded. There is no new polling or provider call on relationship entry. Growing card collections are paged, and last-message reads fetch indexed metadata only, not bodies.
- Production schema rehearsal checked all 42 existing relationships, then rolled back. A second transaction rehearsed real contact/message writes, a subset sale, declined resale, exact outbox snapshots, replay and payment isolation, then rolled back. No external send or charge was made.

Migration: `20260913120000_relationship_card_workspace.sql`, SHA-256 `f2936e1cb2c8d1af4bc625083523ee6593f743b1372627ec408c7f450e681b10`.

Release and authenticated verification are recorded below after deployment. No production latency improvement is claimed; physical Android/iPhone and live provider delivery are separate checks.

## Remaining cases for SS-04 and later packages

- Andy: website already completed; Google Ads already onboarded but still in Setup. Preserve that progress without a second payment or another complete onboarding request. New purchases and recording existing work need distinct entry paths.
- A new service may need only missing answers or connection modules from an already-onboarded client. Reuse compatible answers while keeping sale/session ownership explicit.
- Services sold together may become ready at different times. Define independent readiness and review without reopening finished work.
- Two active sessions can request overlapping information; revoking/restarting one must preserve the other session, its work and billing.
- An email-only relationship can exist, but automated onboarding currently needs a confirmed WhatsApp or Twilio method. Billing still needs an email even for phone-only creation.
- Different currencies require separate sales. Historical For later records remain readable and sellable, although the new UI offers Declined.

Rollback should preserve new confirmations, receipts, sales and queued deliveries. Repair or roll back the UI while retaining the compatible schema; never remove accepted work or service history to undo a visual release.

## Production outcome

The exact migration installed successfully after both rollback rehearsals. Post-install verification preserved 42 relationships, 46 sales, 23 onboarding sessions, one service instance, 581 messages and 27 pre-existing outbox rows, with zero contact confirmations created by installation. Confirmation-table RLS is enabled and authenticated RPC execution is denied.

Application commit `68ae0187` deployed successfully to production via [Vercel deployment JnQvhEZEbC1A2heaPxhZc8UPZy6w](https://vercel.com/betelgeze-projects/betelgeze/JnQvhEZEbC1A2heaPxhZc8UPZy6w).

Authenticated desktop Safari inspection on Test Client 17 verified the new header/fields/History, service/contact cards, centered POS, $750 upfront plus $750 monthly selection, four-module published composition, real full-screen onboarding preview, return to the POS, and delivery eligibility. The WhatsApp card displayed its existing confirmation and last outgoing message status; the POS correctly disabled it while a fresh reply is required. Add contact listed only the remaining Phone and Twilio SMS methods. The sale and confirmation controls were not submitted.

A final 390px Chromium interaction check using the actual components verified automatic selection from the service card, preserved a $925 edited draft across closing/reopening, traversed the three steps, disabled unconfirmed SMS and kept the popup inside the viewport (12px–378px with document width 390px). The earlier five-width Chromium/WebKit fixture checks remain geometry evidence. Physical Android/iPhone and real provider delivery have not been tested in this release.

The existing onboarding worker is invoked directly by the sale/retry path after the durable transaction. An independent periodic scheduler was not verified; the release does not claim unattended retry scheduling. Manual retry keeps the exact saved sale/session and chosen destinations.


## Price and list polish — 13 September

POS money fields now preserve decimal text during editing and show two fractional digits after blur, including zero and whole amounts. Onboarding modules use shared sky RoundPills; the catalogue uses emerald service pills and existing default upfront/recurring prices. Enter blurs and flushes single-line background fields, while Notes remains multiline. The separate sales/onboarding history disclosure is removed; recorded service-stage events appear as grouped Gantt milestones without inferred past dates or extra requests.

Validation: 961 tests, scoped ESLint, `git diff --check`, and the production Webpack build passed. Actual-component fixtures passed Chromium and WebKit checks at 320, 390, 639, 640 and 1280px, including decimal editing/formatting, module composition, catalogue pricing, preview, delivery eligibility and zero sale submissions. Both engines also verified Enter blur/autosave and multiline Notes. These are browser fixture checks, not physical-device or live-delivery tests. No database changes are required.
