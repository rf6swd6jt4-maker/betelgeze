# Missing incoming WhatsApp reconfirmations

Date: 20 October 2026. Base: `a6b3b06090a7b345a0e058c25ec7b790345a28be`.

The user authorized investigation, a confirmed fix, and deployment, and clarified that the missing items are incoming client `CONFIRM` replies.

## Cause and production evidence

The WhatsApp webhook records the inbound service-window timestamp, then calls `handleSaleConsentConfirmation`. For an already confirmed selected-service sale, that handler recovered the existing onboarding link and returned `handled: true` without recording the reply. The completed payment-gate branch also returned early without recording it. The webhook then stopped, so Comms had no incoming message to retrieve.

Bounded production inspection found three outbound reconfirmations with provider delivery/read receipts. The existing authenticated chat UI displayed the stored outbound request. For Jason's relationship, `last_whatsapp_inbound_at` advanced to 19 October 2026 at 14:58:27 UTC, but there was no corresponding incoming chat row. His sale matches the affected confirmed selected-service branch. A narrow two-minute diagnostic search found a status-only webhook notice before the inbound timestamp and no retained reply/error payload. The timestamp proves an inbound event; it does not establish its original text or provider ID. No historical message is fabricated or backfilled.

## Change and ownership

Both early-return branches save the actual WhatsApp reply through the established `client_messages` boundary before their existing work. The provider message ID remains the idempotency key. `ON CONFLICT DO NOTHING` preserves the first saved row and prevents duplicate insert events on callback replays. The existing encryption trigger, conversation decoding, authorization, Realtime and recovery readers display the retained message. A later onboarding recovery failure cannot discard the saved reply. Initial consent, onboarding recovery, SMS and outbound reconfirmation sending keep their existing behavior.

The application adds one indexed, idempotent message write only for these previously dropped incoming confirmations. There is no additional interactive chat request, startup work, subscription, timer, schema object or history scan. Normal typing, navigation, chat loading and ordinary message paths are unchanged. The webhook now waits for required durable storage before reporting that the confirmation was handled; no production timing or physical-device claim is made.

The protected alerts contract is unchanged. New inbound rows use the established recipient, unread, encryption and push rules. No historical alert replay is introduced.

## Validation and release

- The production confirmation handler failed seven regression cases before the change, with two unaffected cases passing. After the fix, ten targeted cases pass, including the actual WhatsApp inbound handler and a repeated provider callback.
- Coverage includes both early-return branches, duplicate preservation, a second distinct reply, storage failure, subsequent onboarding failure, ordinary inbound messages and unchanged SMS behavior.
- All 1,691 repository tests passed. Changed-file lint, immutable migration checks and whitespace checks passed. The production webpack build passed with loopback placeholder configuration.
- Chromium/WebKit foundations and exact-candidate hosted checks are required before advancing production. Their terminal results and deployment identity are reported separately when available.
- Production investigation was read-only. Tests use synthetic inputs and disabled provider dependencies. No client message was sent for testing.

Application rollback preserves received replies, encrypted storage, accepted onboarding work, alert jobs and existing migrations. No migration or data rewrite is needed for release.
