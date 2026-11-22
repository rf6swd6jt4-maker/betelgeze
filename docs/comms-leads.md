# Leads in Comms

Status: being built (pilot). The user asked on 22 November 2026 to "add 'leads' to Comms, add a chat button for each lead" and, asked how lead texts should be read, counted and alerted, answered: **"Just make it follow the same rules as the rest of Comms right now and make it a third tab in Comms."** The authorization is recorded in `app-alerts.md`.

## Design

A lead's text conversation is a **native conversation of a new kind, `lead`** (`workspace_native_conversations.kind = 'lead'`, `lead_id`). Its messages are ordinary `workspace_native_messages`, so the existing machinery applies unchanged:

- **Encryption:** bodies are encrypted at rest by the same per-conversation Vault keys and insert path.
- **Reading:** the shared reader (`useConversationRead`, kind `native`), the read queue, `advance_communication_read` / the device RPC and the newest-visible, focused-window rule are reused as they are.
- **Unread:** the account and device summaries count lead messages like any other native message. They report them with kind **`lead`** instead of `native`, so they count in the Leads tab badge and the Comms total, not in Team.
- **Push:** the existing enqueue, claim, prepare and delivery pipeline. A lead's inbound text has no staff sender (`sender_user_id` is null, `sms_direction = 'inbound'`); enqueue treats it as a message from outside, like a client's inbound message.
- **Who belongs to a lead conversation:** its participants. When the conversation is made, they are the workspace's owners and admins who have Campaigns (`CAMPAIGNS_PILOT_USERS`). They are the recipients of its alerts and the only people who can read it. This mirrors a Team chat's members.

Texts travel through SignalHouse (`docs/signalhouse.md`):

- **Inbound:** `MESSAGE_RECEIVED` on a connected number finds the lead by phone (the one texted most recently on that number, else the most recent lead with that phone in the workspace), creates their conversation if needed, and stores the text as an inbound message. A text from an unknown phone is kept in `signalhouse_webhook_events` and not shown yet.
- **Outbound:** the Leads composer sends through `POST /message/sms` from the lead's number (the one that first texted them, else their source's, else the campaign's), stores the message with the staff sender, and records the number on the lead (`campaign_leads.sms_number_id`) the first time.
- **Delivery:** `MESSAGE_DELIVERED`, `MESSAGE_FAILED`, `SMS_FAILED` update the message's `sms_status`.
- **Opt-outs:** SignalHouse enforces STOP. A send that SignalHouse blocks is shown as failed.

## Comms

- **Third tab:** Clients | Team | **Leads**, for people with Campaigns. The Leads list, its conversation and composer follow the Team tab's rows, bubbles and composer. The header names the lead, their source tag and stage, and links to the lead's page.
- **Chat buttons:** on the lead page header, the campaign's Leads list and the pipeline cards. Chat opens that lead's conversation in the docked Comms panel where it is offered (desktop, Today layout), and in the Comms page elsewhere, exactly like a client's Chat. It never opens on its own.

## Phases

1. **Database and texting** (this branch): the migration, the SignalHouse inbound, outbound and status pipeline, push copy for lead texts, and the summary's `lead` kind. Validated with the full-schema SQL replay.
2. **Comms UI:** the Leads tab, composer and Chat buttons, plus the browser suites.

## Not in scope

Assigning leads to setters (alerts go to all participants), unknown-sender conversations, MMS, Text flows (automated sends), and changing any rule for client or Team chats.
