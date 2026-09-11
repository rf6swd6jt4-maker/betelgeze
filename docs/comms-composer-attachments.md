# Comms composer attachments

Prepared for production release on 2026-09-11. Deployment confirmation is recorded separately after the production build is ready.

Team and direct chats accept up to ten attachments in one message. Repeated file-picker selections append files. The composer shows bounded local thumbnails, filename, upload progress, remove/cancel, and per-file retry. A failed or unfinished file blocks sending the batch; removing it allows the remaining files to send. Sent images share one message bubble and open individually. Message deletion cleans up every file and its preview.

Client chats use the same progress, thumbnail, cancellation, and retry UI, with one attachment per message. Multi-file client delivery is not implemented here. Twilio supports up to ten MMS media files totaling 5 MB ([documentation](https://www.twilio.com/docs/messaging/api/media-resource)); WhatsApp's ordinary image message API describes one image object ([Meta SDK reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/image/)). Enabling client batches needs destination-specific delivery and client-portal projection work; these constraints do not limit Team/direct messages.

## Storage and recovery

The first native attachment stays at the root of the existing encrypted JSON object; up to nine additional files live in `additionalAttachments`. Existing single-file messages remain compatible. The existing encryption trigger encrypts the entire object, so no schema migration is required. Each file keeps its own existing storage key and is independently verified against the conversation before the single message insert. Invalid, duplicate, nested, oversized, and mixed-sticker batches are rejected. Request IDs and the durable message outbox remain unchanged.

Pending files belong to their conversation and survive switching chats while the workspace component remains mounted. They are held against removal during durable message acceptance; only the accepted snapshot is removed from the composer. Failed files retry independently. File selection itself is not persisted across full reloads. Unmount cancels unfinished transfers and releases local preview URLs. Completed sent attachment metadata remains in the existing durable outbox.

## Speed assessment

Affected actions: file selection, upload, composing while uploading, switching chats with pending files, sending, displaying and deleting attachments.

- One decode/upload runs at a time, preserving the previous single-file concurrency. Batches are capped at ten files per message and fifty pending files across conversations.
- Per-file request structure is unchanged: prepare/sign, direct original PUT, and optional preview PUT. Sending ten files creates one message write instead of ten; storage verification still checks every file.
- Thumbnails reuse the existing bounded preview generation. WebKit's PNG fallback is reused locally, without another decode or upload.
- Progress uses actual XHR byte events, reserves completion until upload acceptance, and labels final processing separately. It only notifies the attachment strip. A regression test emits ninety progress events and observes zero chat-summary notifications.
- Existing visible-first, four-slot sent-media admission remains in place. No new inbox/history reads, subscriptions, page reloads, or background polling were added.

No matched production latency benchmark was performed. Browser fixtures verify behavior and geometry, not production network performance or physical-device responsiveness.

## Verification

- Repository suite: 880 tests passed on the release checkout, including the current production image-loading changes.
- Changed-file ESLint and `git diff --check`: passed.
- Production webpack build, including Next.js TypeScript validation: passed.
- Chromium and WebKit isolated fixtures: 390 × 844 mobile and 1280 × 900 desktop; multi-file selection, progress/send blocking, chat switching during upload, removal, retry, one two-image message, individual image opening, local thumbnails, and no horizontal page overflow.
- Runtime route tests: all files verified before one insert, failure prevents partial insertion, invalid batches rejected, retry reuses existing acknowledgement without re-verifying/uploading siblings.
- Queue tests: bounded concurrency, order, conversation isolation, cancellation and late completion, failed-file retry, accepted-snapshot consumption, send-time holds, and preview cleanup.

Not verified: authenticated production uploads/encrypted database round trips, real provider delivery, physical iPhone/Safari/PWA keyboard and touch behavior. No production messages or provider calls were sent. Old resident app tabs should be refreshed after deployment to read complete multi-file messages.
