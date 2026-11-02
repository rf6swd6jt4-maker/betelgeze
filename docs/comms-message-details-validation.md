# Comms message details validation

Local candidate based on `05c21bde`, 2 November 2026. Staff Client, Team and direct chats are in scope. All browser data was synthetic and provider delivery was disabled.

## Reproduction and behavior

On the unchanged app in Chromium, entering a draft and then delivering an inbound WhatsApp event through the workspace’s existing Realtime callback changed the composer into “24hr window expired — send reconfirmation”. The old clock sample preceded the new message. The candidate checks the current clock and schedules the next window boundary only while the workspace is active. A reply received while typing keeps the draft editable, passes the previous expiry and closes at the renewed deadline.

Reaction previews project the existing authorized reaction rows. An update builds one index shared by the inbox and bubble rendering. Older target bodies stay on demand. The preview uses the message or reaction time without changing the message order or any read cursor. Removal restores the next available activity. Like the existing reaction chips, cold previews depend on the rows the existing bootstrap returns. A workspace exceeding its provider response limit was not exercised.

Message info opens from the existing action menu. The compact dialog keeps the close button visible and scrolls the contents on short screens. The roster excludes the sender and distinguishes staff account confirmation from client delivery receipts. Legacy creation-time placeholders give a status without an exact event time. The additional content loads when info opens. No receipt data request, message write, new subscription or database migration is needed.

## Checks

| Check | Result |
| --- | --- |
| Repository tests | 1,877 passed |
| Foundation changed-file lint and whitespace check | Passed |
| Production webpack build, including its TypeScript check | Passed with isolated placeholder configuration |
| Standalone TypeScript including test fixtures, with TypeScript import extensions enabled | Identical 36 existing diagnostics on the base and candidate |
| Comms action browser pack | 15 cases in each of Chromium and WebKit, all passed |
| Protected read and lifecycle browser packs | 40 cases per mobile/desktop pack, both engines, 320 checks passed |

Browser coverage includes arrival during a draft, actual expiry, a reaction to unloaded history, reaction removal, read updates with info open, client delivery times, 320-pixel view-only access, and desktop keyboard access in a direct chat. Unit coverage includes timestamp precision, older snapshots, deletions and revoked access.

On a warmed 390 × 844 Chromium fixture, 12 alternating text insertions per build took a median of 29.7 ms on the base (29.4–30.2 ms) and 29.5 ms on the candidate (28.8–29.8 ms) from the beforeinput event to the second animation frame. The draft content was checked after every insertion. These are synthetic observations. Production latency, authenticated provider callbacks and physical Android/iPhone interaction were not measured.

## Release and rollback

The candidate is local. Reverting the application changes restores the previous UI. The separate staff read-time design has no runtime or schema changes. Existing messages, drafts, read positions and provider records require no data migration or rollback.
