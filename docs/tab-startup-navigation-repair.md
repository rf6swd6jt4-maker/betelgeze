# New-tab startup navigation repair

27 September 2026. Base: `4ac3abac`. The duplicated tab can commit a real document before its navigation/departure receiver mounts. An immediate sidebar navigation previously ran a draft-safety check without a receiver, refused departure and displayed “Action failed,” despite no failed save.

The shell now waits for the exact target frame's local receiver before capturing owner identity and running the existing departure handshake/final check. A newer navigation, account change or disposal cancels the wait. At most one 50 ms local readiness probe is active for the latest intent, bounded to 30 seconds; it makes no network request and stops as soon as readiness is present. Mounted frames take the existing path without waiting. A startup timeout retains the owner and offers a navigation retry instead of a failed-save notice. Actual failed saves, late edits, owner changes and unconfirmed departures still refuse disposal.

The receiver is not proof of painted content or safe drafts: the existing navigation readiness and save/final-confirmation owners remain authoritative. No automatic iframe reload or retry is introduced. Communications layout/read/unread semantics, source records, APIs, providers and migrations are unchanged.

Regression evidence includes actual extracted shell callbacks: delayed startup, edits during the wait, a new destination cancelling the old one, ordinary save refusal, retryable timeout and timer cleanup on readiness/timeout/abort. Chromium/WebKit departure fixtures include the delayed receiver cases alongside the existing draft-loss/final-check matrix. Full app tests/build and the hosted Foundations suites remain release gates. Synthetic fixtures do not establish physical-device acceptance.

Rollback: revert this scoped application change, preserving data and migrations. The previous version retains drafts but restores the misleading startup error.
